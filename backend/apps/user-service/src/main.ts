import { bootstrapGrpcWithHealth, getGrpcOptions } from '@app/common';
import { UserServiceModule } from './user-service.module';

async function bootstrap() {
  // gRPC는 3001 포트, 헬스체크(GET /health)용 HTTP는 3101 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    UserServiceModule,
    getGrpcOptions('user', 'user.proto', '0.0.0.0:3001'),
    3101,
  );
}
bootstrap();
