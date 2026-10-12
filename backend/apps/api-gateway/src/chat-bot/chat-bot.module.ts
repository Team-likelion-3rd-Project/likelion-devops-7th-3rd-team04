import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { getGrpcOptions } from '@app/common';
import { ChatBotController } from './chat-bot.controller';

@Module({
  imports: [
    // chat-bot-service gRPC 클라이언트 등록
    ClientsModule.register([
      {
        name: 'CHAT_BOT_SERVICE', // DI(의존성 주입)에 사용될 토큰 명
        ...getGrpcOptions(
          'chatBot', // chat-bot.proto의 package명
          'chat-bot.proto', // proto 파일명
          process.env.CHAT_BOT_SERVICE_HOST || 'localhost:3005', // chat-bot-service gRPC 주소
        ),
      },
    ]),
  ],
  controllers: [ChatBotController],
})
export class ChatBotModule {}
