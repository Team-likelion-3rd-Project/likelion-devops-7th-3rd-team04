import { bootstrapGrpcWithHealth, getGrpcOptions } from '@app/common';
import { ChatBotServiceModule } from './chat-bot-service.module';

async function bootstrap() {
  // gRPC는 3005 포트, 헬스체크(GET /health)용 HTTP는 3105 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    ChatBotServiceModule,
    getGrpcOptions('chatBot', 'chat-bot.proto', '0.0.0.0:3005'),
    3105,
  );
}
bootstrap();
