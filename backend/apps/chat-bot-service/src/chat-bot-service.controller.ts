import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { ChatBotServiceService } from './chat-bot-service.service';

interface SendMessageRequest {
  userId: number;
  message: string;
}

interface SendMessageResponse {
  sessionId: string;
  reply: string;
  createdAt: string;
}

interface GetHistoryRequest {
  userId: number;
}

interface ChatMessageDto {
  role: string;
  content: string;
  createdAt: string;
}

interface GetHistoryResponse {
  messages: ChatMessageDto[];
}

@Controller()
export class ChatBotServiceController {
  constructor(private readonly chatBotServiceService: ChatBotServiceService) {}

  @GrpcMethod('ChatBotService', 'GetHello')
  getHello(): { message: string } {
    return { message: this.chatBotServiceService.getHello() };
  }

  @GrpcMethod('ChatBotService', 'SendMessage')
  async sendMessage(data: SendMessageRequest): Promise<SendMessageResponse> {
    return this.chatBotServiceService.sendMessage(data.userId, data.message);
  }

  @GrpcMethod('ChatBotService', 'GetHistory')
  async getHistory(data: GetHistoryRequest): Promise<GetHistoryResponse> {
    const messages = await this.chatBotServiceService.getHistory(data.userId);
    return { messages };
  }
}
