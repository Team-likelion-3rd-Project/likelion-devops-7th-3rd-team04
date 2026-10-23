import { JwtService } from '@nestjs/jwt';
import { of, throwError } from 'rxjs';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { parseApiRpcError } from '@app/common';
import { AuthServiceService } from './auth-service.service';
import { Credential } from './entities/credential.entity';
import { AdminCredential } from './entities/admin-credential.entity';

// LDP-96: 회원가입·탈퇴가 중간에 실패해도 계정 데이터가 어긋나지 않게
describe('AuthServiceService 가입·탈퇴 정합성', () => {
  const user = {
    id: 7,
    email: 'a@t.com',
    name: '홍길동',
    phoneNumber: '010-0000-0000',
    role: 'USER',
    status: 'ACTIVE',
  };
  const createUser = jest.fn();
  const cancelSignup = jest.fn();
  const deleteUser = jest.fn();
  const countUpcomingReservations = jest.fn();
  const credentialSave = jest.fn();
  const credentialDelete = jest.fn();
  const redisSet = jest.fn();
  const redisDel = jest.fn();
  // 단계가 실행된 순서
  const steps: string[] = [];
  let service: AuthServiceService;

  const codeOf = (error: unknown) => parseApiRpcError(error)?.code;
  const register = () =>
    service
      .register({
        email: user.email,
        password: 'Passw0rd!',
        name: user.name,
        phoneNumber: user.phoneNumber,
      })
      .catch((e: unknown) => e);
  const withdraw = () =>
    service.withdraw({ userId: 7 }).catch((e: unknown) => e);

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.JWT_REFRESH_ABSOLUTE_MAX_DAYS = '30';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    steps.length = 0;
    createUser.mockReturnValue(of(user));
    cancelSignup.mockReturnValue(of({ success: true }));
    deleteUser.mockImplementation(() => {
      steps.push('profile');
      return of({ success: true });
    });
    countUpcomingReservations.mockReturnValue(of({ count: 0 }));
    credentialSave.mockResolvedValue({});
    credentialDelete.mockImplementation(() => {
      steps.push('credential');
      return Promise.resolve({ affected: 1 });
    });
    redisSet.mockResolvedValue('OK');
    redisDel.mockImplementation(() => {
      steps.push('session');
      return Promise.resolve(1);
    });
    service = new AuthServiceService(
      {
        create: (data: unknown) => data,
        save: credentialSave,
        delete: credentialDelete,
      } as unknown as Repository<Credential>,
      {} as Repository<AdminCredential>,
      new JwtService({}),
      { getService: () => ({ createUser, cancelSignup, deleteUser }) } as never,
      { getService: () => ({ countUpcomingReservations }) } as never,
      { set: redisSet, del: redisDel } as unknown as Redis,
    );
    service.onModuleInit();
  });

  describe('회원가입', () => {
    it('정상: 프로필 → 비밀번호 → 토큰 발급', async () => {
      const result = await register();

      expect(result).toMatchObject({ userId: 7, email: user.email });
      expect(credentialSave).toHaveBeenCalledTimes(1);
      expect(cancelSignup).not.toHaveBeenCalled();
    });

    it('비밀번호 저장 실패 → 만든 프로필을 되돌리고 503 SIGNUP_FAILED (같은 이메일로 다시 가입 가능)', async () => {
      credentialSave.mockRejectedValue(new Error('auth DB 연결 끊김'));

      const error = await register();

      expect(parseApiRpcError(error)).toMatchObject({
        status: 503,
        code: 'SIGNUP_FAILED',
        retryable: true,
      });
      expect(cancelSignup).toHaveBeenCalledWith({ id: 7, email: user.email });
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('프로필 되돌리기까지 실패해도 응답은 SIGNUP_FAILED (로그·알람만 남김)', async () => {
      credentialSave.mockRejectedValue(new Error('auth DB 연결 끊김'));
      cancelSignup.mockReturnValue(
        throwError(() => new Error('user-service down')),
      );

      expect(codeOf(await register())).toBe('SIGNUP_FAILED');
    });

    it('토큰 발급(Valkey)만 실패 → 503 SIGNUP_COMPLETED_LOGIN_REQUIRED, 계정은 되돌리지 않는다', async () => {
      redisSet.mockRejectedValue(new Error('NOAUTH Authentication required.'));

      const error = await register();

      expect(parseApiRpcError(error)).toMatchObject({
        status: 503,
        code: 'SIGNUP_COMPLETED_LOGIN_REQUIRED',
        retryable: false,
      });
      expect(credentialSave).toHaveBeenCalledTimes(1);
      expect(cancelSignup).not.toHaveBeenCalled();
    });
  });

  describe('회원 탈퇴', () => {
    it('세션 → 비밀번호 → 프로필 순서로 지운다 (프로필이 마지막)', async () => {
      expect(await withdraw()).toEqual({ success: true });

      expect(steps).toEqual([
        'session',
        'session',
        'session',
        'credential',
        'profile',
      ]);
    });

    it('세션 삭제(Valkey)가 실패하면 503 WITHDRAW_INCOMPLETE — 비밀번호·프로필은 그대로', async () => {
      redisDel.mockRejectedValue(new Error('NOAUTH'));

      const error = await withdraw();

      expect(parseApiRpcError(error)).toMatchObject({
        code: 'WITHDRAW_INCOMPLETE',
        retryable: true,
      });
      expect(credentialDelete).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
    });

    it('프로필 이관이 실패하면 503 WITHDRAW_INCOMPLETE — 다시 요청하면 끝까지 처리된다', async () => {
      deleteUser.mockReturnValueOnce(
        throwError(() => ({ code: 14, details: 'No connection established' })),
      );

      expect(codeOf(await withdraw())).toBe('WITHDRAW_INCOMPLETE');
      // 재시도: 이미 지운 세션·비밀번호는 다시 지워도 문제없고, 프로필까지 끝난다
      expect(await withdraw()).toEqual({ success: true });
      expect(deleteUser).toHaveBeenCalledTimes(2);
    });

    it('이전 요청에서 프로필까지 끝났는데 응답만 못 받은 경우 → 다시 요청해도 성공', async () => {
      deleteUser.mockReturnValue(
        throwError(() => ({ code: 2, details: '존재하지 않는 유저입니다.' })),
      );

      expect(await withdraw()).toEqual({ success: true });
    });
  });
});
