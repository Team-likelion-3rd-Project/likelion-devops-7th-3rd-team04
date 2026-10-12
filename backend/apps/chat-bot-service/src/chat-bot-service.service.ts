import { Injectable } from '@nestjs/common';
import { SessionService } from './session/session.service';
import { MessageService } from './message/message.service';
import { N8nClient } from './n8n/n8n.client';

export interface SendMessageResult {
  sessionId: string;
  reply: string;
  createdAt: string;
}

export interface HistoryMessage {
  role: string;
  content: string;
  createdAt: string;
}

@Injectable()
export class ChatBotServiceService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly messageService: MessageService,
    private readonly n8nClient: N8nClient,
  ) {}

  getHello(): string {
    return 'Chat Bot Hello World!';
  }

  // userId가 0/falsy면 비로그인 사용자로 간주해 세션·이력을 전혀 만들지 않고,
  // n8n에도 history 없이 단발 질문만 전달합니다 (완전 stateless).
  async sendMessage(
    userId: number,
    message: string,
  ): Promise<SendMessageResult> {
    if (!userId) {
      const { reply } = await this.n8nClient.sendMessage({
        message,
        history: [],
      });
      return { sessionId: '', reply, createdAt: new Date().toISOString() };
    }

    const session = await this.sessionService.getOrCreateSession(userId);
    await this.messageService.appendMessage(session.sessionId, 'USER', message);

    const recentMessages = await this.messageService.getRecentMessages(
      session.sessionId,
    );

    const { reply } = await this.n8nClient.sendMessage({
      sessionId: session.sessionId,
      userId,
      message,
      history: recentMessages.map(({ role, content }) => ({
        role,
        content,
      })),
    });

    const assistantMessage = await this.messageService.appendMessage(
      session.sessionId,
      'ASSISTANT',
      reply,
    );

    return {
      sessionId: session.sessionId,
      reply,
      createdAt: assistantMessage.createdAt,
    };
  }

  // 아직 대화한 적 없는 사용자를 위해 세션을 새로 만들지 않습니다 — 조회는 부작용이 없어야 합니다.
  async getHistory(userId: number): Promise<HistoryMessage[]> {
    const session = await this.sessionService.findByUserId(userId);
    if (!session) {
      return [];
    }

    const messages = await this.messageService.getRecentMessages(
      session.sessionId,
    );

    return messages.map(({ role, content, createdAt }) => ({
      role,
      content,
      createdAt,
    }));
  }
}
