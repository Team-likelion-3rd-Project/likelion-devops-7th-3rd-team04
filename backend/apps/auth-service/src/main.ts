import { bootstrapGrpcWithHealth, getGrpcOptions } from '@app/common';
import { AuthServiceModule } from './auth-service.module';

async function bootstrap() {
  // gRPC는 3006 포트, 헬스체크(GET /health)용 HTTP는 3106 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    AuthServiceModule,
    getGrpcOptions('auth', 'auth.proto', '0.0.0.0:3006'),
    3106,
  );
}
bootstrap();
