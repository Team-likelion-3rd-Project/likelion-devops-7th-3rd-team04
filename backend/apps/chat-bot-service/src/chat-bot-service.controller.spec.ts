import { Test, TestingModule } from '@nestjs/testing';
import { ChatBotServiceController } from './chat-bot-service.controller';
import { ChatBotServiceService } from './chat-bot-service.service';
import { SessionService } from './session/session.service';
import { MessageService } from './message/message.service';
import { N8nClient } from './n8n/n8n.client';

describe('ChatBotServiceController', () => {
  let controller: ChatBotServiceController;
  let sessionService: {
    getOrCreateSession: jest.Mock;
    findByUserId: jest.Mock;
  };
  let messageService: {
    appendMessage: jest.Mock;
    getRecentMessages: jest.Mock;
  };
  let n8nClient: { sendMessage: jest.Mock };

  const session = {
    sessionId: 'session-1',
    userId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    sessionService = {
      getOrCreateSession: jest.fn(),
      findByUserId: jest.fn(),
    };
    messageService = {
      appendMessage: jest.fn(),
      getRecentMessages: jest.fn(),
    };
    n8nClient = { sendMessage: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [ChatBotServiceController],
      providers: [
        ChatBotServiceService,
        { provide: SessionService, useValue: sessionService },
        { provide: MessageService, useValue: messageService },
        { provide: N8nClient, useValue: n8nClient },
      ],
    }).compile();

    controller = app.get<ChatBotServiceController>(ChatBotServiceController);
  });

  describe('getHello', () => {
    it('should return the hello message', () => {
      expect(controller.getHello()).toEqual({
        message: 'Chat Bot Hello World!',
      });
    });
  });

  describe('sendMessage', () => {
    it('never touches session/message services for an anonymous user (userId 0)', async () => {
      n8nClient.sendMessage.mockResolvedValue({ reply: '안녕하세요!' });

      const result = await controller.sendMessage({
        userId: 0,
        message: '안녕',
      });

      expect(sessionService.getOrCreateSession).not.toHaveBeenCalled();
      expect(messageService.appendMessage).not.toHaveBeenCalled();
      expect(n8nClient.sendMessage).toHaveBeenCalledWith({
        message: '안녕',
        history: [],
      });
      expect(result.sessionId).toBe('');
      expect(result.reply).toBe('안녕하세요!');
    });

    it('persists both turns and forwards history for a logged-in user', async () => {
      sessionService.getOrCreateSession.mockResolvedValue(session);
      messageService.getRecentMessages.mockResolvedValue([
        {
          sessionId: session.sessionId,
          messageId: 'm1',
          role: 'USER',
          content: '안녕',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      messageService.appendMessage.mockResolvedValue({
        sessionId: session.sessionId,
        messageId: 'm2',
        role: 'ASSISTANT',
        content: '안녕하세요!',
        createdAt: '2026-01-01T00:00:01.000Z',
      });
      n8nClient.sendMessage.mockResolvedValue({ reply: '안녕하세요!' });

      const result = await controller.sendMessage({
        userId: 1,
        message: '안녕',
      });

      expect(sessionService.getOrCreateSession).toHaveBeenCalledWith(1);
      expect(messageService.appendMessage).toHaveBeenCalledWith(
        session.sessionId,
        'USER',
        '안녕',
      );
      expect(n8nClient.sendMessage).toHaveBeenCalledWith({
        sessionId: session.sessionId,
        userId: 1,
        message: '안녕',
        history: [{ role: 'USER', content: '안녕' }],
      });
      expect(messageService.appendMessage).toHaveBeenCalledWith(
        session.sessionId,
        'ASSISTANT',
        '안녕하세요!',
      );
      expect(result).toEqual({
        sessionId: session.sessionId,
        reply: '안녕하세요!',
        createdAt: '2026-01-01T00:00:01.000Z',
      });
    });
  });

  describe('getHistory', () => {
    it('returns an empty list without creating a session when none exists', async () => {
      sessionService.findByUserId.mockResolvedValue(null);

      const result = await controller.getHistory({ userId: 1 });

      expect(sessionService.getOrCreateSession).not.toHaveBeenCalled();
      expect(result).toEqual({ messages: [] });
    });

    it('returns stored messages for an existing session', async () => {
      sessionService.findByUserId.mockResolvedValue(session);
      messageService.getRecentMessages.mockResolvedValue([
        {
          sessionId: session.sessionId,
          messageId: 'm1',
          role: 'USER',
          content: '안녕',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const result = await controller.getHistory({ userId: 1 });

      expect(result).toEqual({
        messages: [
          {
            role: 'USER',
            content: '안녕',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    });
  });
});
