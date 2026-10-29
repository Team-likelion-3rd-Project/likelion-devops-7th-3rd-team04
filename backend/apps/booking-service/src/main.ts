import {
  bootstrapGrpcWithHealth,
  getGrpcServerOptions,
  startMetrics,
  trackDbPoolMetrics,
} from '@app/common';
import { DataSource } from 'typeorm';
import { BookingServiceModule } from './booking-service.module';

async function bootstrap() {
  // Prometheus 메트릭 — METRICS_PORT가 있을 때만 (LDP-168)
  startMetrics('booking-service');

  // gRPC는 3003 포트, 헬스체크(GET /health)용 HTTP는 3103 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  const app = await bootstrapGrpcWithHealth(
    BookingServiceModule,
    getGrpcServerOptions('booking', 'booking.proto', '0.0.0.0:3003'),
    3103,
  );

  // DB 커넥션 풀 지표 — METRICS_PORT가 있을 때만 (LDP-182)
  trackDbPoolMetrics(app.get(DataSource));
}
bootstrap();
