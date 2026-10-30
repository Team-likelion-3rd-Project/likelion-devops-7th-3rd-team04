import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
  const registerMock = jest.fn();
  const loginMock = jest.fn();
  const refreshMock = jest.fn();
  const logoutMock = jest.fn();
  const changePasswordMock = jest.fn();

  // 컨트롤러가 @Res({ passthrough: true })로 주입받는 response 객체를 흉내낸 목(mock)
  const createResMock = () =>
    ({
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    }) as unknown as Response;

  const tokenPayload = {
    accessToken: 'access',
    refreshToken: 'refresh',
    userId: 1,
    email: 'user@example.com',
    name: '홍길동',
    role: 'USER',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // setRefreshCookie가 하드코딩된 기본값 없이 getRequiredEnv로 읽으므로 테스트에서 직접 채워줍니다.
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    registerMock.mockReturnValue(of(tokenPayload));
    loginMock.mockReturnValue(of(tokenPayload));
    refreshMock.mockReturnValue(
      of({
        ...tokenPayload,
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
    );
    logoutMock.mockReturnValue(of({ success: true }));
    changePasswordMock.mockReturnValue(of({ success: true }));

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: 'AUTH_SERVICE',
          useValue: {
            getService: () => ({
              register: registerMock,
              login: loginMock,
              refresh: refreshMock,
              logout: logoutMock,
              changePassword: changePasswordMock,
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    controller.onModuleInit();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call auth-service, set the refresh cookie, and return the access token + user info', async () => {
      const dto = {
        email: 'user@example.com',
        password: 'password123',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
      };
      const res = createResMock();

      const result = await controller.register(dto, res);

      expect(registerMock).toHaveBeenCalledWith(dto);
      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res.cookie).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        accessToken: 'access',
        userId: 1,
        email: 'user@example.com',
        name: '홍길동',
        role: 'USER',
      });
    });
  });

  describe('login', () => {
    it('should call auth-service, set the refresh cookie, and return the access token + user info', async () => {
      const dto = { email: 'user@example.com', password: 'password123' };
      const res = createResMock();

      const result = await controller.login(dto, res);

      expect(loginMock).toHaveBeenCalledWith(dto);
      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res.cookie).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        accessToken: 'access',
        userId: 1,
        email: 'user@example.com',
        name: '홍길동',
        role: 'USER',
      });
    });

    // LDP-198: 예전에는 모든 실패가 401이라 auth-service·Redis 장애가 "비밀번호 틀림"으로 보였다
    it('이메일·비밀번호가 틀리면 401', async () => {
      loginMock.mockReturnValue(
        throwError(() => ({
          code: GrpcStatus.UNAUTHENTICATED,
          details: '이메일 또는 비밀번호가 일치하지 않습니다.',
        })),
      );

      await expect(
        controller.login(
          { email: 'user@example.com', password: 'wrong-password' },
          createResMock(),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: {
          message: '이메일 또는 비밀번호가 일치하지 않습니다.',
        },
      });
    });

    it('auth-service 장애면 401이 아니라 503', async () => {
      loginMock.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.UNAVAILABLE })),
      );

      await expect(
        controller.login(
          { email: 'user@example.com', password: 'password123' },
          createResMock(),
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          code: 'AUTH_SERVICE_UNAVAILABLE',
        },
      });
    });
  });

  describe('refresh', () => {
    it('should read the refresh token from the cookie, rotate it, and return the new access token', async () => {
      const req = {
        cookies: { refreshToken: 'refresh' },
      } as unknown as Request;
      const res = createResMock();

      const result = await controller.refresh(req, res);

      expect(refreshMock).toHaveBeenCalledWith({ refreshToken: 'refresh' });
      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'new-refresh',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res.cookie).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        accessToken: 'new-access',
        userId: 1,
        email: 'user@example.com',
        name: '홍길동',
        role: 'USER',
      });
    });

    it('should throw UnauthorizedException when the refresh token cookie is missing', async () => {
      const req = { cookies: {} } as unknown as Request;
      const res = createResMock();

      await expect(controller.refresh(req, res)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should call auth-service with the current user id, clear the refresh cookie, and return a success message', async () => {
      const user = {
        userId: 1,
        email: 'user@example.com',
        role: 'USER',
        type: 'USER' as const,
      };
      const res = createResMock();

      const result = await controller.logout(user, res);

      expect(logoutMock).toHaveBeenCalledWith({ userId: 1, type: 'USER' });
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res.clearCookie).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ message: '로그아웃되었습니다.' });
    });
  });

  describe('changePassword', () => {
    it('should call auth-service via gRPC with the current user id and dto, and return a success message', async () => {
      const user = {
        userId: 1,
        email: 'user@example.com',
        role: 'USER',
        type: 'USER' as const,
      };
      const dto = {
        currentPassword: 'password123',
        newPassword: 'newPassword456',
      };

      const result = await controller.changePassword(user, dto);

      expect(changePasswordMock).toHaveBeenCalledWith({ userId: 1, ...dto });
      expect(result).toEqual({ message: '비밀번호가 변경되었습니다.' });
    });

    it('should throw UnauthorizedException when the current password is wrong', async () => {
      changePasswordMock.mockReturnValue(
        throwError(() => ({ message: '현재 비밀번호가 일치하지 않습니다.' })),
      );
      const user = {
        userId: 1,
        email: 'user@example.com',
        role: 'USER',
        type: 'USER' as const,
      };
      const dto = {
        currentPassword: 'wrong-password',
        newPassword: 'newPassword456',
      };

      await expect(controller.changePassword(user, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
