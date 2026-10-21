import { bootstrapGrpcWithHealth, getGrpcOptions } from '@app/common';
import { BookingServiceModule } from './booking-service.module';

async function bootstrap() {
  // gRPC는 3003 포트, 헬스체크(GET /health)용 HTTP는 3103 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    BookingServiceModule,
    getGrpcOptions('booking', 'booking.proto', '0.0.0.0:3003'),
    3103,
  );
}
bootstrap();
