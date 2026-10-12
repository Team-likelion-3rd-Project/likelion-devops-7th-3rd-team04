import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChatBotServiceController } from './chat-bot-service.controller';
import { ChatBotServiceService } from './chat-bot-service.service';
import { DynamoDbModule } from './dynamodb/dynamodb.module';
import { SessionService } from './session/session.service';
import { MessageService } from './message/message.service';
import { N8nClient } from './n8n/n8n.client';

@Module({
  imports: [DynamoDbModule, HttpModule],
  controllers: [ChatBotServiceController],
  providers: [ChatBotServiceService, SessionService, MessageService, N8nClient],
})
export class ChatBotServiceModule {}
