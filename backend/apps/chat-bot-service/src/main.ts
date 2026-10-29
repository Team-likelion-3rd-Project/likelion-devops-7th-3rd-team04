import {
  bootstrapGrpcWithHealth,
  getGrpcServerOptions,
  startMetrics,
} from '@app/common';
import { ChatBotServiceModule } from './chat-bot-service.module';

async function bootstrap() {
  // Prometheus 메트릭 — METRICS_PORT가 있을 때만 (LDP-168)
  startMetrics('chat-bot-service');

  // gRPC는 3005 포트, 헬스체크(GET /health)용 HTTP는 3105 포트로 띄웁니다.
  // SIGTERM 처리(enableShutdownHooks)도 bootstrapGrpcWithHealth 안에서 합니다.
  await bootstrapGrpcWithHealth(
    ChatBotServiceModule,
    getGrpcServerOptions('chatBot', 'chat-bot.proto', '0.0.0.0:3005'),
    3105,
  );
}
bootstrap();
