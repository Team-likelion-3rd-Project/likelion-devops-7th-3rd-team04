import type Redis from 'ioredis';
import { clearReadCacheKeys, ReadCache } from './read-cache';

// Map으로 흉내 낸 Valkey (GET/SET/DEL/INCR만)
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string, mode?: string) => {
      if (mode === 'NX' && store.has(key)) {
        return Promise.resolve(null);
      }
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((...keys: string[]) =>
      Promise.resolve(keys.filter((key) => store.delete(key)).length),
    ),
    incr: jest.fn((key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return Promise.resolve(next);
    }),
  };
}

// getOrLoad는 저장을 기다리지 않으므로, 다음 조회 전에 저장이 끝나게 한 번 양보한다
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ReadCache', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let cache: ReadCache;

  beforeEach(() => {
    redis = fakeRedis();
    cache = new ReadCache(redis as unknown as Redis, 'p:', 60);
  });

  it('처음엔 DB에서 읽어 TTL과 함께 저장하고, 다음엔 캐시에서 읽는다', async () => {
    const load = jest.fn().mockResolvedValue({ id: 1 });

    expect(await cache.getOrLoad('hotel', 'hotel:1', load)).toEqual({ id: 1 });
    await flush();
    expect(redis.set).toHaveBeenCalledWith('p:hotel:1', '{"id":1}', 'EX', 60);

    expect(await cache.getOrLoad('hotel', 'hotel:1', load)).toEqual({ id: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('없는 데이터(null)는 저장하지 않는다', async () => {
    const load = jest.fn().mockResolvedValue(null);

    await cache.getOrLoad('hotel', 'hotel:9', load);
    await flush();
    await cache.getOrLoad('hotel', 'hotel:9', load);

    expect(redis.set).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('Valkey가 실패하면 DB에서 읽고, 무효화 실패도 예외를 던지지 않는다', async () => {
    redis.get.mockRejectedValue(new Error('Connection is closed.'));
    redis.del.mockRejectedValue(new Error('Connection is closed.'));
    const load = jest.fn().mockResolvedValue({ id: 1 });

    expect(await cache.getOrLoad('hotel', 'hotel:1', load)).toEqual({ id: 1 });
    await expect(cache.invalidate('hotel:1')).resolves.toBeUndefined();
  });

  it('저장 실패는 응답에 영향을 주지 않는다', async () => {
    redis.set.mockRejectedValue(new Error('timeout'));

    await expect(
      cache.getOrLoad('hotel', 'hotel:1', () => Promise.resolve({ id: 1 })),
    ).resolves.toEqual({ id: 1 });
    await flush();
  });

  it('깨진 값은 다시 DB에서 읽어 덮어쓴다', async () => {
    redis.store.set('p:hotel:1', '{broken');
    const load = jest.fn().mockResolvedValue({ id: 1 });

    expect(await cache.getOrLoad('hotel', 'hotel:1', load)).toEqual({ id: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('invalidate한 키는 다시 DB에서 읽는다', async () => {
    const load = jest.fn().mockResolvedValue({ id: 1 });
    await cache.getOrLoad('hotel', 'hotel:1', load);
    await flush();

    await cache.invalidate('hotel:1', 'hotels');
    await cache.getOrLoad('hotel', 'hotel:1', load);

    expect(redis.del).toHaveBeenCalledWith('p:hotel:1', 'p:hotels');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('버전을 올리면 버전이 붙은 목록은 모두 다시 DB에서 읽는다', async () => {
    const load = jest.fn().mockResolvedValue({ total: 0 });
    const key = (v: string) => `notices:${v}:page:1`;

    await cache.getOrLoadVersioned('notices', 'notices:version', key, load);
    await flush();
    await cache.getOrLoadVersioned('notices', 'notices:version', key, load);
    expect(load).toHaveBeenCalledTimes(1);

    await cache.bumpVersion('notices:version');
    await cache.getOrLoadVersioned('notices', 'notices:version', key, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('버전 키가 없으면 현재 시각으로 만든다 (0부터 다시 세지 않음)', async () => {
    const before = Date.now();

    await cache.getOrLoadVersioned(
      'notices',
      'v',
      (v) => `n:${v}`,
      () => Promise.resolve({ total: 0 }),
    );

    expect(Number(redis.store.get('p:v'))).toBeGreaterThanOrEqual(before);
  });

  it('버전을 읽지 못하면 캐시를 쓰지 않는다 (옛 버전 목록을 읽지 않게)', async () => {
    redis.get.mockRejectedValue(new Error('timeout'));
    const load = jest.fn().mockResolvedValue({ total: 0 });

    await cache.getOrLoadVersioned('notices', 'v', (v) => `n:${v}`, load);
    await flush();

    expect(load).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('disabled()는 항상 DB에서 읽는다', async () => {
    const disabled = ReadCache.disabled();
    const load = jest.fn().mockResolvedValue({ id: 1 });

    await disabled.getOrLoad('hotel', 'hotel:1', load);
    await disabled.getOrLoad('hotel', 'hotel:1', load);
    await disabled.invalidate('hotel:1');

    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('clearReadCacheKeys', () => {
  // SCAN 결과를 두 페이지(커서 0 → 7 → 0)로 나눠 돌려주는 Valkey. 페이지는 첫 SCAN 때 한 번 정한다
  function scanningRedis(keys: string[]) {
    const store = new Set(keys);
    let pages: string[][] = [];
    return {
      store,
      scan: jest.fn((cursor: string, _m: string, pattern: string) => {
        if (cursor === '0') {
          const prefix = pattern.replace(/\*$/, '');
          const matched = [...store].filter((key) => key.startsWith(prefix));
          const half = Math.ceil(matched.length / 2);
          pages = [matched.slice(0, half), matched.slice(half)];
          return Promise.resolve(['7', pages[0]]);
        }
        return Promise.resolve(['0', pages[1]]);
      }),
      unlink: jest.fn((...targets: string[]) =>
        Promise.resolve(targets.filter((key) => store.delete(key)).length),
      ),
    };
  }

  it('그 서비스의 캐시 키(모든 버전)만 지우고 리프레시 토큰 등 다른 키는 남긴다', async () => {
    const redis = scanningRedis([
      'cache:hotel-service:v1:hotels',
      'cache:hotel-service:v1:hotel:1:rooms',
      'cache:hotel-service:v0:hotels',
      'cache:other-service:v1:x',
      'refresh:42',
      'throttle:1.2.3.4',
    ]);

    const deleted = await clearReadCacheKeys(
      redis as unknown as Redis,
      'hotel-service',
    );

    expect(deleted).toBe(3);
    expect([...redis.store].sort()).toEqual([
      'cache:other-service:v1:x',
      'refresh:42',
      'throttle:1.2.3.4',
    ]);
    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'cache:hotel-service:*',
      'COUNT',
      500,
    );
  });

  it('지울 키가 없으면 UNLINK를 보내지 않는다', async () => {
    const redis = scanningRedis(['refresh:42']);

    expect(
      await clearReadCacheKeys(redis as unknown as Redis, 'hotel-service'),
    ).toBe(0);
    expect(redis.unlink).not.toHaveBeenCalled();
  });
});
