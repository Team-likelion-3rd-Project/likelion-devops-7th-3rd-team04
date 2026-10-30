import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
  const registerMock = jest.fn();
  const loginMock = jest.fn();
  const refreshMock = jest.fn();
  const logoutMock = jest.fn();
  const changePasswordMock = jest.fn();
  const socialLoginMock = jest.fn();

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
              socialLogin: socialLoginMock,
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
      const user = { userId: 1, email: 'user@example.com', role: 'USER', type: 'USER' as const };
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
      const user = { userId: 1, email: 'user@example.com', role: 'USER', type: 'USER' as const };
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
      const user = { userId: 1, email: 'user@example.com', role: 'USER', type: 'USER' as const };
      const dto = {
        currentPassword: 'wrong-password',
        newPassword: 'newPassword456',
      };

      await expect(controller.changePassword(user, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // LDP-194: 카카오 로그인 state는 이 브라우저 쿠키와 같아야 한다
  describe('kakaoLogin', () => {
    const dto = { code: 'code-1', state: 'state-1' };
    const reqWith = (cookies: Record<string, string>) =>
      ({ cookies }) as unknown as Request;

    it('state 쿠키가 없거나 다르면 auth-service를 부르지 않고 400 SOCIAL_STATE_INVALID', async () => {
      const res = createResMock();

      const error = await controller
        .kakaoLogin(dto, reqWith({ socialState: 'other' }), res)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        statusCode: 400,
        code: 'SOCIAL_STATE_INVALID',
      });
      expect(socialLoginMock).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith('socialState', expect.anything());
    });

    it('연결된 회원이면 리프레시 쿠키를 심고 로그인 응답 + signupRequired: false', async () => {
      socialLoginMock.mockReturnValue(
        of({
          signupRequired: false,
          signupToken: '',
          email: '',
          name: '',
          auth: { ...tokenPayload, socialProvider: 'KAKAO' },
        }),
      );
      const res = createResMock();

      const result = await controller.kakaoLogin(dto, reqWith({ socialState: 'state-1' }), res);

      expect(socialLoginMock).toHaveBeenCalledWith({ provider: 'KAKAO', ...dto });
      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toMatchObject({ signupRequired: false, accessToken: 'access', socialProvider: 'KAKAO' });
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('처음 온 회원이면 쿠키 없이 가입 대기 토큰만 돌려준다', async () => {
      socialLoginMock.mockReturnValue(
        of({ signupRequired: true, signupToken: 'tok', email: 'k@t.com', name: '닉', auth: null }),
      );
      const res = createResMock();

      const result = await controller.kakaoLogin(dto, reqWith({ socialState: 'state-1' }), res);

      expect(result).toEqual({ signupRequired: true, signupToken: 'tok', email: 'k@t.com', name: '닉' });
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });
});
