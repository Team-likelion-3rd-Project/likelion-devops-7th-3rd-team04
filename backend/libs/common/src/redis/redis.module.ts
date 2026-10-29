import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

// REDIS_* 환경변수로 접속 정보를 만듭니다. api-gateway 요청 제한 저장소(throttle-storage.ts)도 같은 값을 씁니다.
export function redisOptionsFromEnv(): RedisOptions {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    // 같은 Redis를 쓰는 다른 용도(GitLab CI 이미지 smoke test 등)와 키가 섞이지 않게 DB 번호를 분리할 때 사용
    db: Number(process.env.REDIS_DB || 0),
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  };
}

// auth-service가 리프레시 토큰을 저장/조회/삭제하는 데 사용하는 ioredis 클라이언트를 등록합니다.
// 로컬 개발: docker-compose의 redis 컨테이너, 운영: AWS ElastiCache (REDIS_TLS=true + REDIS_PASSWORD=AUTH 토큰)
// 엔드포인트만 바뀌는 것이므로, ElastiCache로 전환할 때도 이 파일은 그대로 두고 env var만 교체하면 됩니다.
// ⚠️ 클러스터 모드(ElastiCache Cluster Mode Enabled)를 쓰게 되면 Redis.Cluster로 바꿔야 합니다 (현재 미지원).
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis => new Redis(redisOptionsFromEnv()),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  // Nest 애플리케이션 종료 시 연결을 정리합니다.
  async onModuleDestroy() {
    await this.redisClient.quit();
  }
}
