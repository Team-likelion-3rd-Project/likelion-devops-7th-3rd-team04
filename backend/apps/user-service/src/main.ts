import {
  bootstrapGrpcWithHealth,
  getGrpcServerOptions,
  startMetrics,
} from '@app/common';
import { UserServiceModule } from './user-service.module';

async function bootstrap() {
  // Prometheus 메트릭 — METRICS_PORT가 있을 때만 (LDP-168)
  startMetrics('user-service');

  // gRPC는 3001 포트, 헬스체크(GET /health)용 HTTP는 3101 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    UserServiceModule,
    getGrpcServerOptions('user', 'user.proto', '0.0.0.0:3001'),
    3101,
  );
}
bootstrap();
