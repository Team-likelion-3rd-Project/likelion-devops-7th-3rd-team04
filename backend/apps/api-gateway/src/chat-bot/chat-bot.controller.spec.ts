import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { HttpException } from '@nestjs/common';
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
      expect(result).toEqual({ ...sendMessageResponse, action: null });
    });

    it('returns action null when gRPC sends a null action (proto defaults)', async () => {
      sendMessageMock.mockReturnValue(
        of({ ...sendMessageResponse, action: null }),
      );

      const result = await controller.sendMessage({ message: '안녕' }, user);

      expect(result.action).toBeNull();
    });

    it('maps a BOOK action, turning proto empty values into null', async () => {
      sendMessageMock.mockReturnValue(
        of({
          ...sendMessageResponse,
          action: {
            type: 'BOOK',
            hotel: 'busan',
            roomName: '',
            checkIn: '2026-12-01',
            checkOut: '2026-12-03',
            adults: 2,
            children: 0,
          },
        }),
      );

      const result = await controller.sendMessage({ message: '예약' }, user);

      expect(result.action).toEqual({
        type: 'BOOK',
        hotel: 'busan',
        roomName: null,
        checkIn: '2026-12-01',
        checkOut: '2026-12-03',
        adults: 2,
        children: 0,
      });
    });

    it.each(['PAY', 'CANCEL', 'LOGIN_REQUIRED'])(
      'maps a %s action to type only',
      async (type) => {
        sendMessageMock.mockReturnValue(
          of({
            ...sendMessageResponse,
            action: {
              type,
              hotel: '',
              roomName: '',
              checkIn: '',
              checkOut: '',
              adults: 0,
              children: 0,
            },
          }),
        );

        const result = await controller.sendMessage({ message: '...' }, user);

        expect(result.action).toEqual({
          type,
          hotel: null,
          roomName: null,
          checkIn: null,
          checkOut: null,
          adults: null,
          children: null,
        });
      },
    );

    it('passes the authenticated userId for a logged-in caller', async () => {
      await controller.sendMessage({ message: '안녕' }, user);

      expect(sendMessageMock).toHaveBeenCalledWith({
        userId: 1,
        message: '안녕',
      });
    });

    it('gRPC 장애는 503이고 내부 주소를 노출하지 않는다 (LDP-238)', async () => {
      sendMessageMock.mockReturnValue(
        throwError(() => ({
          code: 14,
          details:
            'Name resolution failed for target dns:chat-bot-service:3005',
        })),
      );

      const error = await controller
        .sendMessage({ message: '안녕' }, null)
        .catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'CHAT_BOT_SERVICE_UNAVAILABLE',
      });
      expect(
        JSON.stringify((error as HttpException).getResponse()),
      ).not.toContain('dns:');
    });
  });

  describe('getHistory', () => {
    it('returns the current session history for the logged-in user', async () => {
      const result = await controller.getHistory(user);

      expect(getHistoryMock).toHaveBeenCalledWith({ userId: 1 });
      expect(result).toEqual(historyResponse);
    });

    it('gRPC 장애는 503이다 (LDP-238)', async () => {
      getHistoryMock.mockReturnValue(
        throwError(() => ({ code: 4, details: 'Deadline exceeded' })),
      );

      const error = await controller.getHistory(user).catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(503);
    });
  });
});
