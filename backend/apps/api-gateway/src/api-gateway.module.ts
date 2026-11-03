import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { HotelModule } from './hotel/hotel.module';
import { BookingController } from './booking/booking.controller';
import { PaymentController } from './payment/payment.controller';
import { ChatBotController } from './chat-bot/chat-bot.controller';
import { ChatBotModule } from './chat-bot/chat-bot.module';
import { PaymentModule } from './payment/payment.module';
import { BookingModule } from './booking/booking.module';
import { NoticeModule } from './notice/notice.module';
import { HealthModule } from '@app/common';
import { throttleLimitFromEnv } from './throttle-limit';
import { createThrottlerStorage } from './throttle-storage';

@Module({
  imports: [
    // GET /health 헬스체크 엔드포인트 (libs/common/src/health)
    HealthModule,
    // 게이트웨이 전역 rate limit. 기본값은 기존 라우트에 영향을 주지 않도록 넉넉하게 잡고,
    // 익명 호출을 허용하는 라우트(예: 챗봇 메시지 전송)에서는 @Throttle()로 더 타이트하게 덮어씁니다.
    // 키는 클라이언트 IP입니다(main.ts의 configureTrustProxy 참고).
    // 요청 수는 Valkey에 모아 세므로 api-gateway Pod가 여러 개여도 한도는 그대로입니다(throttle-storage.ts).
    // REDIS_HOST가 없거나 Valkey 장애 중에는 Pod 메모리로 세어, 실제 한도가 replica 수 × limit까지 늘어납니다.
    // 기본 한도는 THROTTLE_LIMIT 환경변수로 바꿀 수 있습니다(부하 테스트용, throttle-limit.ts).
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: throttleLimitFromEnv(),
          },
        ],
        storage: createThrottlerStorage(),
      }),
    }),
    AuthModule,
    UserModule,
    HotelModule,
    ChatBotModule,
    PaymentModule,
    BookingModule,
    NoticeModule,
  ],
  controllers: [ApiGatewayController],
  providers: [
    ApiGatewayService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class ApiGatewayModule {}
