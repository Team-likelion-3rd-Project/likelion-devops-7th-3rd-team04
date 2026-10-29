import { Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ThrottlerGuard,
  ThrottlerModule,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import Redis from 'ioredis';
import request from 'supertest';
import {
  createThrottlerStorage,
  ValkeyThrottlerStorage,
} from './throttle-storage';

// 로컬 Valkey(docker-compose의 redis 컨테이너)의 DB 15번을 테스트 전용으로 쓴다.
// Valkey가 없으면(CI 등) Valkey가 필요한 테스트는 건너뛴다.
const TEST_DB = '15';

@Controller()
class ThrottledController {
  @Get('default')
  byDefault() {
    return 'ok';
  }
}

describe('createThrottlerStorage', () => {
  const original = process.env.REDIS_HOST;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.REDIS_HOST;
    } else {
      process.env.REDIS_HOST = original;
    }
  });

  it('REDIS_HOST가 없으면 Pod 메모리 저장소(기존 방식)', () => {
    delete process.env.REDIS_HOST;
    expect(createThrottlerStorage()).toBeInstanceOf(ThrottlerStorageService);
  });
});

describe('Valkey 장애 시', () => {
  it('요청을 막지 않고 Pod 메모리로 센다', async () => {
    const broken = {
      eval: jest.fn().mockRejectedValue(new Error('Connection is closed.')),
      quit: jest.fn().mockResolvedValue('OK'),
    } as unknown as Redis;
    const storage = new ValkeyThrottlerStorage(broken);

    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const record = await storage.increment('k', 60_000, 2, 60_000, 'default');
      results.push(record.isBlocked);
    }
    expect(results).toEqual([false, false, true]);
    await storage.onApplicationShutdown();
  });
});

describe('Valkey에 연결할 수 없을 때', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('기다리지 않고 바로 메모리로 센다 (요청이 느려지지 않는다)', async () => {
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '1'; // 연결이 거부되는 포트
    const storage = createThrottlerStorage() as ValkeyThrottlerStorage;
    try {
      const started = Date.now();
      const record = await storage.increment(
        'down',
        60_000,
        5,
        60_000,
        'default',
      );
      expect(Date.now() - started).toBeLessThan(100);
      expect(record).toMatchObject({ totalHits: 1, isBlocked: false });
    } finally {
      await storage.onApplicationShutdown();
    }
  });
});

describe('Valkey 공유 저장소', () => {
  const env = { ...process.env };
  let admin: Redis;
  let available = false;

  beforeAll(async () => {
    admin = new Redis({
      host: 'localhost',
      db: Number(TEST_DB),
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    admin.on('error', () => {});
    available = await admin
      .connect()
      .then(() => true)
      .catch(() => false);
    if (!available) {
      console.warn(
        '로컬 Valkey(localhost:6379)가 없어 Valkey 테스트를 건너뜁니다',
      );
    }
  });

  beforeEach(async () => {
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_DB = TEST_DB;
    delete process.env.REDIS_PASSWORD;
    delete process.env.REDIS_TLS;
    if (available) {
      const keys = await admin.keys('throttle:*');
      if (keys.length) await admin.del(...keys);
    }
  });

  afterEach(() => {
    process.env = { ...env };
  });

  afterAll(() => {
    if (available) admin.disconnect();
  });

  // gateway Pod 하나를 흉내 낸다 — api-gateway.module.ts와 같은 설정
  const startPod = async (limit: number) => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRootAsync({
          useFactory: () => ({
            throttlers: [{ name: 'default', ttl: 60_000, limit }],
            storage: createThrottlerStorage(),
          }),
        }),
      ],
      controllers: [ThrottledController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    await app.init();
    return app;
  };

  it('Pod 2개가 요청을 나눠 받아도 합쳐서 한도를 센다', async () => {
    if (!available) return;
    const pods = [await startPod(100), await startPod(100)];
    try {
      // 번갈아 보내면 Pod마다 50회씩 — 메모리 저장소였다면 200회까지 통과한다
      const statuses: number[] = [];
      for (let i = 0; i < 101; i++) {
        const pod = pods[i % 2];
        statuses.push(
          (await request(pod.getHttpServer()).get('/default')).status,
        );
      }
      expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
      expect(statuses[100]).toBe(429);

      // 막힌 뒤에는 다른 Pod로 가도 막힌다
      const other = await request(pods[0].getHttpServer()).get('/default');
      expect(other.status).toBe(429);
      expect(Number(other.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await Promise.all(pods.map((pod) => pod.close()));
    }
  });

  it('차단 시간이 지나면 0부터 다시 센다', async () => {
    if (!available) return;
    const storage = createThrottlerStorage() as ValkeyThrottlerStorage;
    await storage.onModuleInit();
    try {
      const hit = () => storage.increment('reset', 60_000, 2, 300, 'default');
      expect((await hit()).totalHits).toBe(1);
      expect((await hit()).totalHits).toBe(2);
      const blocked = await hit();
      expect(blocked.isBlocked).toBe(true);
      expect(blocked.timeToBlockExpire).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = await hit();
      expect(after.isBlocked).toBe(false);
      expect(after.totalHits).toBe(1);
    } finally {
      await storage.onApplicationShutdown();
    }
  });

  it('요청 수 키에는 만료 시간이 붙는다 (Valkey에 남아 쌓이지 않게)', async () => {
    if (!available) return;
    const storage = createThrottlerStorage() as ValkeyThrottlerStorage;
    await storage.onModuleInit();
    try {
      const record = await storage.increment(
        'ttl',
        60_000,
        10,
        60_000,
        'default',
      );
      expect(record.timeToExpire).toBe(60);
      const pttl = await admin.pttl('throttle:{default:ttl}:hits');
      expect(pttl).toBeGreaterThan(59_000);
      expect(pttl).toBeLessThanOrEqual(60_000);
    } finally {
      await storage.onApplicationShutdown();
    }
  });
});
