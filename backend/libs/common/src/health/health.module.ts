import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// 각 서비스의 루트 모듈 imports에 추가하면 GET /health가 등록됩니다.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
