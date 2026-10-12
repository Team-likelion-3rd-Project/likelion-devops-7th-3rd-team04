import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { getGrpcOptions } from '@app/common';
import { ChatBotServiceModule } from './chat-bot-service.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ChatBotServiceModule,
    getGrpcOptions('chatBot', 'chat-bot.proto', '0.0.0.0:3005'),
  );
  // api-gateway/src/main.ts와 동일한 이유 — SIGTERM 시 진행 중인 gRPC 요청을 마무리할
  // 기회를 준다(deployment.yaml의 terminationGracePeriodSeconds/preStop과 세트).
  app.enableShutdownHooks();
  await app.listen();
}
bootstrap();
