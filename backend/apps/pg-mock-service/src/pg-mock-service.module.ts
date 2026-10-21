import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsModule } from './payments/payments.module';
import { HealthModule } from '@app/common';

@Module({
  imports: [
    // GET /health 헬스체크 엔드포인트 (libs/common/src/health)
    HealthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PaymentsModule,
  ],
})
export class PgMockServiceModule {}
