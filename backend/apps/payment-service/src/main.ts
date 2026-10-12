import { bootstrapGrpcWithHealth, getGrpcOptions } from '@app/common';
import { PaymentServiceModule } from './payment-service.module';

async function bootstrap() {
  // gRPC는 3004 포트, 헬스체크(GET /health)용 HTTP는 3104 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    PaymentServiceModule,
    getGrpcOptions('payment', 'payment.proto', '0.0.0.0:3004'),
    3104,
  );
}
bootstrap();
