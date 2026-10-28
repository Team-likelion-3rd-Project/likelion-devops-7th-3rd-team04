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

@Module({
  imports: [
    // GET /health 헬스체크 엔드포인트 (libs/common/src/health)
    HealthModule,
    // 게이트웨이 전역 rate limit. 기본값은 기존 라우트에 영향을 주지 않도록 넉넉하게 잡고,
    // 익명 호출을 허용하는 라우트(예: 챗봇 메시지 전송)에서는 @Throttle()로 더 타이트하게 덮어씁니다.
    // 키는 클라이언트 IP입니다(main.ts의 configureTrustProxy 참고).
    // 저장소가 Pod 메모리라 실제 한도는 api-gateway replica 수 × limit입니다(Redis 공유 저장소는 후속 과제).
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 100,
      },
    ]),
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
