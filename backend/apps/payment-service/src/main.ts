import {
  bootstrapGrpcWithHealth,
  getGrpcServerOptions,
  startMetrics,
} from '@app/common';
import { PaymentServiceModule } from './payment-service.module';

async function bootstrap() {
  // Prometheus 메트릭 — METRICS_PORT가 있을 때만 (LDP-168)
  startMetrics('payment-service');

  // gRPC는 3004 포트, 헬스체크(GET /health)용 HTTP는 3104 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    PaymentServiceModule,
    getGrpcServerOptions('payment', 'payment.proto', '0.0.0.0:3004'),
    3104,
  );
}
bootstrap();
