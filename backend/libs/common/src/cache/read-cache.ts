import { Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { redisOptionsFromEnv } from '../redis/redis.module';

// 조회 캐시 (Valkey, cache-aside). 자주 읽고 드물게 바뀌는 데이터(호텔·객실·편의시설·공지)를 DB 대신 Valkey에서 읽는다.
//  - 읽기: GET → 없으면 DB에서 읽어 SET(EX = TTL). null(없는 데이터)은 저장하지 않는다
//  - 쓰기: DB 반영 뒤 해당 키를 DEL(invalidate) — TTL은 무효화를 놓쳤을 때의 안전장치다
//  - Valkey 장애·미설정이면 매번 DB에서 읽는다 (캐시 장애가 서비스 장애로 번지지 않게)
// 날짜별 재고·예약처럼 정합성이 중요한 데이터는 캐시하지 않는다.
// 접속 정보는 auth-service와 같은 REDIS_HOST/PORT/PASSWORD/DB/TLS 환경변수.

// 명령이 이보다 오래 걸리면 실패로 보고 DB에서 읽는다 (DB 조회보다 길게 기다리지 않게)
const COMMAND_TIMEOUT_MS = 200;
const TTL_SECONDS = 300;

export class ReadCache implements OnApplicationShutdown {
  private readonly logger = new Logger(ReadCache.name);
  // 장애 중 매 요청마다 찍히지 않게 처음 한 번만 경고
  private failing = false;

  constructor(
    private readonly redis: Redis | null,
    private readonly prefix: string,
    private readonly ttlSeconds: number,
  ) {}

  // 항상 DB에서 읽는 캐시 (REDIS_HOST 없음 · 테스트)
  static disabled(): ReadCache {
    return new ReadCache(null, '', 0);
  }

  // name은 로그·메트릭에서 캐시 종류를 구분하는 이름(rooms 등)이라 ID를 넣지 않는다. ID는 key에 넣는다.
  // load가 null/undefined를 돌려주면(없는 데이터) 저장하지 않는다.
  async getOrLoad<T>(
    name: string,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    if (!this.redis) {
      return load();
    }
    const fullKey = this.prefix + key;

    let cached: string | null;
    try {
      cached = await this.redis.get(fullKey);
      this.recovered();
    } catch (err) {
      this.fail(name, err);
      return load();
    }

    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // 깨진 값이면 없는 것으로 보고 다시 채운다
      }
    }

    const value = await load();
    if (value !== null && value !== undefined) {
      // 응답을 기다리게 하지 않는다. 저장 실패는 다음 요청이 다시 DB에서 읽을 뿐이다
      this.redis
        .set(fullKey, JSON.stringify(value), 'EX', this.ttlSeconds)
        .catch((err: unknown) => this.fail(name, err));
    }
    return value;
  }

  // 페이지·필터 조합마다 키가 생기는 목록(공지 목록 등)을 한 번에 무효화할 때 쓴다.
  // 읽기: 버전을 읽어 key(version)으로 getOrLoad. 쓰기: bumpVersion으로 버전을 올리면 이전 키는 읽히지 않고 TTL로 사라진다.
  async getOrLoadVersioned<T>(
    name: string,
    versionKey: string,
    key: (version: string) => string,
    load: () => Promise<T>,
  ): Promise<T> {
    if (!this.redis) {
      return load();
    }
    let version: string;
    try {
      version = await this.currentVersion(this.prefix + versionKey);
    } catch (err) {
      // 버전을 모르면 옛 버전 키를 읽을 수 있으므로 캐시를 쓰지 않는다
      this.fail(name, err);
      return load();
    }
    return this.getOrLoad(name, key(version), load);
  }

  // DB를 바꾼 뒤 호출한다. 실패해도 예외를 던지지 않는다 (TTL이 지나면 맞춰진다)
  async invalidate(...keys: string[]): Promise<void> {
    if (!this.redis || keys.length === 0) {
      return;
    }
    try {
      await this.redis.del(...keys.map((key) => this.prefix + key));
    } catch (err) {
      this.fail('invalidate', err);
    }
  }

  async bumpVersion(versionKey: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.incr(this.prefix + versionKey);
    } catch (err) {
      this.fail('invalidate', err);
    }
  }

  async onApplicationShutdown() {
    await this.redis?.quit().catch(() => this.redis?.disconnect());
  }

  // 버전 키가 없으면(첫 사용·Valkey 재시작) 현재 시각으로 만든다 — 0부터 다시 세면 아직 TTL이 남은 옛 목록 키와 겹칠 수 있다
  private async currentVersion(fullKey: string): Promise<string> {
    const redis = this.redis as Redis;
    const existing = await redis.get(fullKey);
    if (existing !== null) {
      return existing;
    }
    const initial = String(Date.now());
    const created = await redis.set(fullKey, initial, 'NX');
    return created ? initial : ((await redis.get(fullKey)) ?? initial);
  }

  private fail(name: string, err: unknown) {
    if (!this.failing) {
      this.failing = true;
      this.logger.warn(
        `Valkey 조회 캐시 실패(${name}) — 복구될 때까지 DB에서 읽습니다: ${(err as Error).message}`,
      );
    }
  }

  private recovered() {
    if (this.failing) {
      this.failing = false;
      this.logger.log('Valkey 조회 캐시 복구');
    }
  }
}

// REDIS_HOST가 있으면 Valkey 캐시, 없으면 항상 DB에서 읽는 캐시.
// 키는 cache:<서비스>:v1:... — 같은 Valkey의 리프레시 토큰·요청 제한 키와 섞이지 않는다.
// 캐시 값의 모양을 바꾸면 v1을 올린다 (배포 중 옛 Pod·새 Pod가 서로 다른 모양을 읽지 않게).
export function createReadCacheFromEnv(service: string): ReadCache {
  const logger = new Logger(ReadCache.name);
  if (!process.env.REDIS_HOST) {
    logger.log('조회 캐시 꺼짐 (REDIS_HOST 없음) — 매번 DB에서 읽습니다');
    return ReadCache.disabled();
  }
  const redis = new Redis({
    ...redisOptionsFromEnv(),
    // 연결이 끊긴 동안 명령을 쌓아 두지 않고 바로 실패시켜, 요청이 기다리지 않고 DB로 넘어가게 한다
    enableOfflineQueue: false,
    commandTimeout: COMMAND_TIMEOUT_MS,
  });
  // 리스너가 없으면 재연결 시도마다 'Unhandled error event'가 찍힌다. 경고는 실패한 요청에서 한 번만 남긴다
  redis.on('error', () => {});
  logger.log(`조회 캐시 켜짐 — TTL ${TTL_SECONDS}초`);
  return new ReadCache(redis, `cache:${service}:v1:`, TTL_SECONDS);
}
