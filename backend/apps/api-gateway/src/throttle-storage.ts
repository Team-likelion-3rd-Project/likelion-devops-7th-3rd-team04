import { Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { redisOptionsFromEnv } from '@app/common';
import Redis from 'ioredis';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

// 요청 수 세기와 차단을 한 번에(원자적으로) 처리하는 Lua 스크립트. 시간 단위는 모두 ms.
// KEYS[1]=요청 수, KEYS[2]=차단 표시 / ARGV[1]=ttl, ARGV[2]=limit, ARGV[3]=blockDuration
// 반환: { 요청 수, 남은 시간, 차단 여부(1/0), 남은 차단 시간 }
// 차단할 때 요청 수를 지워서, 차단이 풀리면 새 구간이 0부터 시작한다(기본 메모리 저장소와 같은 동작).
const INCREMENT_SCRIPT = `
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = math.max(tonumber(ARGV[3]), 1)
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { limit + 1, blockTtl, 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
local hitsTtl = redis.call('PTTL', KEYS[1])
if hitsTtl < 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
  hitsTtl = ttl
end
if hits > limit then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], 1, 'PX', block)
  return { hits, block, 1, block }
end
return { hits, hitsTtl, 0, 0 }
`;

// Valkey 응답이 이보다 늦으면 실패로 보고 Pod 메모리로 센다 — 요청 제한 때문에 API가 느려지지 않게
const COMMAND_TIMEOUT_MS = 500;
// 앱이 뜰 때 Valkey 연결을 이만큼 기다린다. 넘으면 그냥 뜨고, 연결될 때까지는 메모리로 센다
const CONNECT_WAIT_MS = 3000;

// 요청 제한 카운터를 Valkey에 두어 모든 api-gateway Pod가 같은 숫자를 보게 한다 (LDP-187).
// Pod 메모리에 따로 세면 Pod가 N개일 때 실제 한도가 limit × N까지 늘어난다.
// Valkey가 죽거나 느리면 요청을 막지 않고, 복구될 때까지 Pod 메모리(기존 방식)로 센다.
export class ValkeyThrottlerStorage
  implements ThrottlerStorage, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(ValkeyThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private failing = false;

  constructor(private readonly redis: Redis) {}

  // 연결 전에는 명령이 바로 실패하므로(enableOfflineQueue: false), 첫 요청부터 Valkey로 세도록 연결을 기다린다
  async onModuleInit() {
    if (this.redis.status === 'ready') return;
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CONNECT_WAIT_MS);
      this.redis.once('ready', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!ready) {
      this.logger.warn(
        'Valkey에 연결하지 못해 연결될 때까지 Pod 메모리로 요청 제한을 셉니다',
      );
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // {...}는 Valkey 클러스터에서도 두 키가 같은 슬롯에 들어가게 하는 표시
    const base = `throttle:{${throttlerName}:${key}}`;
    try {
      const [totalHits, expireMs, blocked, blockMs] = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${base}:hits`,
        `${base}:blocked`,
        ttl,
        limit,
        blockDuration,
      )) as number[];
      if (this.failing) {
        this.failing = false;
        this.logger.log('Valkey 복구 — 요청 제한을 다시 Valkey에서 셉니다');
      }
      return {
        totalHits,
        timeToExpire: Math.ceil(expireMs / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockMs / 1000),
      };
    } catch (err) {
      // 장애 중 매 요청마다 찍히지 않게 처음 한 번만 경고
      if (!this.failing) {
        this.failing = true;
        this.logger.warn(
          `Valkey 요청 제한 실패 — 복구될 때까지 Pod 메모리로 셉니다: ${(err as Error).message}`,
        );
      }
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  async onApplicationShutdown() {
    this.fallback.onApplicationShutdown();
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

// REDIS_HOST가 있으면 Valkey 공유 저장소, 없으면 Pod 메모리 저장소(기존 방식)를 쓴다.
// 접속 정보는 auth-service와 같은 REDIS_HOST/PORT/PASSWORD/DB/TLS 환경변수.
export function createThrottlerStorage(): ThrottlerStorage {
  if (!process.env.REDIS_HOST) {
    return new ThrottlerStorageService();
  }
  const redis = new Redis({
    ...redisOptionsFromEnv(),
    // 연결이 끊긴 동안 명령을 쌓아 두지 않고 바로 실패시켜, 요청이 기다리지 않고 메모리로 넘어가게 한다
    enableOfflineQueue: false,
    commandTimeout: COMMAND_TIMEOUT_MS,
  });
  // 리스너가 없으면 재연결 시도마다 'Unhandled error event'가 찍힌다. 경고는 increment에서 한 번만 남긴다
  redis.on('error', () => {});
  return new ValkeyThrottlerStorage(redis);
}
