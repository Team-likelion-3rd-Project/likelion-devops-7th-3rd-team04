import {
  bootstrapGrpcWithHealth,
  getGrpcOptions,
  startMetrics,
} from '@app/common';
import { HotelServiceModule } from './hotel-service.module';

async function bootstrap() {
  // Prometheus 메트릭 — METRICS_PORT가 있을 때만 (LDP-168)
  startMetrics('hotel-service');

  // gRPC는 3002 포트, 헬스체크(GET /health)용 HTTP는 3102 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    HotelServiceModule,
    getGrpcOptions('hotel', 'hotel.proto', '0.0.0.0:3002'),
    3102,
  );
}
bootstrap();
