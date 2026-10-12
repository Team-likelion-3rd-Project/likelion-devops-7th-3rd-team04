import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { AuthenticatedUser } from '@app/common';
import { ChatBotController } from './chat-bot.controller';

describe('ChatBotController', () => {
  let controller: ChatBotController;
  const getHelloMock = jest.fn();
  const sendMessageMock = jest.fn();
  const getHistoryMock = jest.fn();

  const user: AuthenticatedUser = {
    userId: 1,
    email: 'user@example.com',
    role: 'USER',
    type: 'USER',
  };

  const sendMessageResponse = {
    sessionId: 'session-1',
    reply: '안녕하세요! 무엇을 도와드릴까요?',
    createdAt: '2026-08-15T00:00:00.000Z',
  };

  const historyResponse = {
    messages: [
      { role: 'USER', content: '안녕', createdAt: '2026-08-15T00:00:00.000Z' },
      {
        role: 'ASSISTANT',
        content: '안녕하세요!',
        createdAt: '2026-08-15T00:00:01.000Z',
      },
    ],
  };

  beforeEach(async () => {
    getHelloMock.mockReturnValue(of({ message: 'Chat Bot Hello World!' }));
    sendMessageMock.mockReturnValue(of(sendMessageResponse));
    getHistoryMock.mockReturnValue(of(historyResponse));

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatBotController],
      providers: [
        {
          provide: 'CHAT_BOT_SERVICE',
          useValue: {
            getService: () => ({
              getHello: getHelloMock,
              sendMessage: sendMessageMock,
              getHistory: getHistoryMock,
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<ChatBotController>(ChatBotController);
    controller.onModuleInit();
  });

  describe('sendMessage', () => {
    it('passes userId 0 for an anonymous (no-token) caller', async () => {
      const result = await controller.sendMessage({ message: '안녕' }, null);

      expect(sendMessageMock).toHaveBeenCalledWith({
        userId: 0,
        message: '안녕',
      });
      expect(result).toEqual(sendMessageResponse);
    });

    it('passes the authenticated userId for a logged-in caller', async () => {
      await controller.sendMessage({ message: '안녕' }, user);

      expect(sendMessageMock).toHaveBeenCalledWith({
        userId: 1,
        message: '안녕',
      });
    });

    it('maps a gRPC failure to ServiceUnavailableException', async () => {
      sendMessageMock.mockReturnValue(
        throwError(() => ({ message: 'AI 응답 생성에 실패했습니다.' })),
      );

      await expect(
        controller.sendMessage({ message: '안녕' }, null),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getHistory', () => {
    it('returns the current session history for the logged-in user', async () => {
      const result = await controller.getHistory(user);

      expect(getHistoryMock).toHaveBeenCalledWith({ userId: 1 });
      expect(result).toEqual(historyResponse);
    });

    it('maps a gRPC failure to ServiceUnavailableException', async () => {
      getHistoryMock.mockReturnValue(
        throwError(() => ({ message: '대화 이력 조회에 실패했습니다.' })),
      );

      await expect(controller.getHistory(user)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
