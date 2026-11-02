import { JwtService } from '@nestjs/jwt';
import { of, throwError } from 'rxjs';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { parseApiRpcError } from '@app/common';
import { AuthServiceService } from './auth-service.service';
import { Credential } from './entities/credential.entity';
import { AdminCredential } from './entities/admin-credential.entity';
import { SocialAccount } from './entities/social-account.entity';
import { KakaoOAuthClient } from './kakao-oauth.client';

// LDP-194: 카카오 로그인 — state 확인, 가입 대기 토큰, 같은 이메일 거절, 소셜 회원의 비밀번호 없는 계정 처리
describe('AuthServiceService 카카오 로그인', () => {
  const REDIRECT_URI = 'http://localhost:5174/auth/kakao/callback';
  const user = {
    id: 7,
    email: 'kakao@t.com',
    name: '홍길동',
    phoneNumber: '010-0000-0000',
    role: 'USER',
    status: 'ACTIVE',
  };
  const linked = {
    id: 1,
    userId: 7,
    provider: 'KAKAO',
    providerUserId: '12345',
    email: user.email,
  } as SocialAccount;

  const createUser = jest.fn();
  const cancelSignup = jest.fn();
  const getUserByEmail = jest.fn();
  const getUserById = jest.fn();
  const archiveOrphanProfile = jest.fn();
  const credentialFindOne = jest.fn();
  const credentialSave = jest.fn();
  const socialFindOne = jest.fn();
  const socialSave = jest.fn();
  const redisGet = jest.fn();
  const redisGetdel = jest.fn();
  const redisSet = jest.fn();
  const redisDel = jest.fn();
  let kakao: KakaoOAuthClient;
  let getProfile: jest.SpyInstance;
  let service: AuthServiceService;

  const codeOf = (error: unknown) => parseApiRpcError(error)?.code;
  const notFound = () =>
    throwError(() => ({ code: 5, details: '가입되지 않은 이메일입니다.' }));

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.JWT_REFRESH_ABSOLUTE_MAX_DAYS = '30';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KAKAO_CLIENT_ID = 'test-kakao-key';
    process.env.KAKAO_REDIRECT_URIS = `${REDIRECT_URI}, http://localhost:5175/auth/kakao/callback`;
    createUser.mockReturnValue(of(user));
    cancelSignup.mockReturnValue(of({ success: true }));
    getUserByEmail.mockReturnValue(notFound());
    getUserById.mockReturnValue(of(user));
    archiveOrphanProfile.mockReturnValue(of({ success: true }));
    credentialFindOne.mockResolvedValue(null);
    credentialSave.mockResolvedValue({});
    socialFindOne.mockResolvedValue(null);
    socialSave.mockResolvedValue({});
    redisGetdel.mockResolvedValue(REDIRECT_URI);
    redisSet.mockResolvedValue('OK');
    redisDel.mockResolvedValue(1);

    kakao = new KakaoOAuthClient();
    getProfile = jest.spyOn(kakao, 'getProfile').mockResolvedValue({
      id: '12345',
      email: user.email,
      nickname: '카카오닉',
    });
    service = new AuthServiceService(
      {
        create: (data: unknown) => data,
        save: credentialSave,
        findOne: credentialFindOne,
      } as unknown as Repository<Credential>,
      {} as Repository<AdminCredential>,
      {
        create: (data: unknown) => data,
        save: socialSave,
        findOne: socialFindOne,
      } as unknown as Repository<SocialAccount>,
      kakao,
      new JwtService({}),
      {
        getService: () => ({
          createUser,
          cancelSignup,
          getUserByEmail,
          getUserById,
          archiveOrphanProfile,
        }),
      } as never,
      { getService: () => ({}) } as never,
      {
        get: redisGet,
        getdel: redisGetdel,
        set: redisSet,
        del: redisDel,
      } as unknown as Redis,
    );
    service.onModuleInit();
  });

  describe('인가 화면 주소', () => {
    it('state를 10분 보관하고 카카오 인가 화면 주소를 돌려준다', async () => {
      const { url, state } = await service.socialAuthorizeUrl({
        provider: 'KAKAO',
        redirectUri: REDIRECT_URI,
      });

      expect(state).toMatch(/^[0-9a-f]{32}$/);
      expect(url).toContain('https://kauth.kakao.com/oauth/authorize?');
      expect(url).toContain(`state=${state}`);
      expect(url).toContain(`redirect_uri=${encodeURIComponent(REDIRECT_URI)}`);
      expect(url).toContain('scope=profile_nickname%2Caccount_email');
      expect(redisSet).toHaveBeenCalledWith(
        `social:state:${state}`,
        REDIRECT_URI,
        'EX',
        600,
      );
    });

    it('등록되지 않은 주소면 400 SOCIAL_REDIRECT_URI_INVALID', async () => {
      const error = await service
        .socialAuthorizeUrl({
          provider: 'KAKAO',
          redirectUri: 'https://evil.example/cb',
        })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('SOCIAL_REDIRECT_URI_INVALID');
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('카카오 앱 키가 없는 환경이면 503 SOCIAL_LOGIN_DISABLED', async () => {
      process.env.KAKAO_CLIENT_ID = '';

      const error = await service
        .socialAuthorizeUrl({ provider: 'KAKAO', redirectUri: REDIRECT_URI })
        .catch((e: unknown) => e);

      expect(parseApiRpcError(error)).toMatchObject({
        status: 503,
        code: 'SOCIAL_LOGIN_DISABLED',
      });
    });
  });

  describe('인가 코드 로그인', () => {
    const login = () =>
      service
        .socialLogin({ provider: 'KAKAO', code: 'code-1', state: 'state-1' })
        .catch((e: unknown) => e);

    it('state가 없거나 이미 쓰였으면 400 SOCIAL_STATE_INVALID(재시도 불가) — 카카오를 부르지 않는다', async () => {
      redisGetdel.mockResolvedValue(null);

      expect(parseApiRpcError(await login())).toMatchObject({
        status: 400,
        code: 'SOCIAL_STATE_INVALID',
        retryable: false,
      });
      expect(getProfile).not.toHaveBeenCalled();
    });

    it('이미 연결된 카카오 계정이면 그 회원으로 로그인 (socialProvider: KAKAO)', async () => {
      socialFindOne.mockResolvedValue(linked);

      const result = await login();

      expect(getProfile).toHaveBeenCalledWith('code-1', REDIRECT_URI);
      expect(result).toMatchObject({
        signupRequired: false,
        auth: { userId: 7, email: user.email, socialProvider: 'KAKAO' },
      });
      expect(createUser).not.toHaveBeenCalled();
    });

    it('처음 온 회원이면 회원을 만들지 않고 가입 대기 토큰만 10분 보관', async () => {
      const result = await login();

      expect(result).toMatchObject({
        signupRequired: true,
        email: user.email,
        name: '카카오닉',
      });
      const { signupToken } = result as { signupToken: string };
      expect(redisSet).toHaveBeenCalledWith(
        `social:signup:${signupToken}`,
        expect.any(String),
        'EX',
        600,
      );
      const [, saved] = redisSet.mock.calls[0] as [string, string];
      expect(JSON.parse(saved)).toMatchObject({
        provider: 'KAKAO',
        providerUserId: '12345',
        email: user.email,
      });
      expect(
        typeof (JSON.parse(saved) as { expiresAt: unknown }).expiresAt,
      ).toBe('number');
      expect(createUser).not.toHaveBeenCalled();
    });

    it('카카오 이메일이 없거나 인증되지 않았으면 400 SOCIAL_EMAIL_REQUIRED', async () => {
      getProfile.mockResolvedValue({
        id: '12345',
        email: null,
        nickname: null,
      });

      expect(codeOf(await login())).toBe('SOCIAL_EMAIL_REQUIRED');
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('같은 이메일로 이메일 가입한 회원이 있으면 합치지 않고 409 SOCIAL_EMAIL_IN_USE', async () => {
      getUserByEmail.mockReturnValue(of({ ...user, id: 3 }));
      credentialFindOne.mockResolvedValue({ userId: 3 });

      expect(codeOf(await login())).toBe('SOCIAL_EMAIL_IN_USE');
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('이메일 확인 중 user-service 장애면 미가입으로 보지 않고 503 SOCIAL_LOGIN_UNAVAILABLE', async () => {
      getUserByEmail.mockReturnValue(
        throwError(() => ({ code: 14, details: 'connect ECONNREFUSED' })),
      );

      expect(parseApiRpcError(await login())).toMatchObject({
        status: 503,
        code: 'SOCIAL_LOGIN_UNAVAILABLE',
      });
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('카카오 연결만 남고 프로필이 없으면 503 재시도 대신 404 SOCIAL_ACCOUNT_NOT_FOUND', async () => {
      socialFindOne.mockResolvedValue(linked);
      getUserById.mockReturnValue(
        throwError(() => ({ code: 5, details: '존재하지 않는 유저입니다.' })),
      );

      expect(parseApiRpcError(await login())).toMatchObject({
        status: 404,
        code: 'SOCIAL_ACCOUNT_NOT_FOUND',
        retryable: false,
      });
    });
  });

  describe('추가 정보 입력 후 가입', () => {
    const pending = JSON.stringify({
      provider: 'KAKAO',
      providerUserId: '12345',
      email: user.email,
      expiresAt: Date.now() + 300_000,
    });
    const signup = () =>
      service
        .socialSignup({
          signupToken: 'token-1',
          name: '홍길동',
          phoneNumber: '010-0000-0000',
        })
        .catch((e: unknown) => e);

    it('정상: 프로필 → 카카오 연결 → 토큰 발급 (비밀번호는 만들지 않음)', async () => {
      redisGetdel.mockResolvedValue(pending);

      const result = await signup();

      expect(createUser).toHaveBeenCalledWith({
        email: user.email,
        name: '홍길동',
        phoneNumber: '010-0000-0000',
      });
      expect(socialSave).toHaveBeenCalledWith({
        userId: 7,
        provider: 'KAKAO',
        providerUserId: '12345',
        email: user.email,
      });
      expect(credentialSave).not.toHaveBeenCalled();
      // 토큰은 처음에 getdel로 꺼냈으므로 되돌리지 않는다
      expect(redisGetdel).toHaveBeenCalledWith('social:signup:token-1');
      expect(redisSet).not.toHaveBeenCalledWith(
        'social:signup:token-1',
        expect.anything(),
        'EX',
        expect.anything(),
      );
      expect(result).toMatchObject({ userId: 7, socialProvider: 'KAKAO' });
    });

    it('가입 대기 토큰이 만료됐으면 400 SOCIAL_SIGNUP_EXPIRED', async () => {
      redisGetdel.mockResolvedValue(null);

      expect(codeOf(await signup())).toBe('SOCIAL_SIGNUP_EXPIRED');
      expect(createUser).not.toHaveBeenCalled();
    });

    it('카카오 연결 저장 실패 → 만든 프로필을 되돌리고 503 SIGNUP_FAILED', async () => {
      redisGetdel.mockResolvedValue(pending);
      socialSave.mockRejectedValue(new Error('auth DB 연결 끊김'));

      expect(codeOf(await signup())).toBe('SIGNUP_FAILED');
      expect(cancelSignup).toHaveBeenCalledWith({ id: 7, email: user.email });
      // 다시 눌러 볼 수 있게 가입 대기 토큰을 남은 시간만큼 되돌린다
      expect(redisSet).toHaveBeenCalledWith(
        'social:signup:token-1',
        pending,
        'EX',
        expect.any(Number),
      );
      const [, , , ttl] = redisSet.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
    });

    it('동시에 두 번 요청하면 토큰을 먼저 꺼낸 요청만 가입 — 나머지는 회원을 만들지 않는다', async () => {
      redisGetdel.mockResolvedValueOnce(pending).mockResolvedValueOnce(null);

      const [first, second] = await Promise.all([signup(), signup()]);

      expect(createUser).toHaveBeenCalledTimes(1);
      expect(first).toMatchObject({ userId: 7, socialProvider: 'KAKAO' });
      expect(codeOf(second)).toBe('SOCIAL_SIGNUP_EXPIRED');
    });

    it('대기 중 같은 이메일로 이메일 가입이 끝났으면 409 SOCIAL_EMAIL_IN_USE — 토큰은 되돌리지 않음', async () => {
      redisGetdel.mockResolvedValue(pending);
      getUserByEmail.mockReturnValue(of({ ...user, id: 3 }));
      credentialFindOne.mockResolvedValue({ userId: 3 });

      expect(codeOf(await signup())).toBe('SOCIAL_EMAIL_IN_USE');
      expect(createUser).not.toHaveBeenCalled();
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('확인과 생성 사이에 같은 이메일로 가입되면(ALREADY_EXISTS) 409 SOCIAL_EMAIL_IN_USE', async () => {
      redisGetdel.mockResolvedValue(pending);
      createUser.mockReturnValue(
        throwError(() => ({ code: 6, details: '이미 가입된 이메일입니다.' })),
      );

      expect(codeOf(await signup())).toBe('SOCIAL_EMAIL_IN_USE');
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('가입 버튼을 두 번 눌러 이미 연결됐으면 새로 만들지 않고 그 회원으로 로그인', async () => {
      redisGetdel.mockResolvedValue(pending);
      socialFindOne.mockResolvedValue(linked);

      const result = await signup();

      expect(createUser).not.toHaveBeenCalled();
      expect(result).toMatchObject({ userId: 7, socialProvider: 'KAKAO' });
    });
  });

  describe('소셜 회원과 기존 기능', () => {
    it('카카오로 가입된 이메일로 이메일 가입 → 프로필을 정리하지 않고 409 SOCIAL_ACCOUNT_EXISTS', async () => {
      getUserByEmail.mockReturnValue(of(user));
      socialFindOne.mockResolvedValue(linked);

      const error = await service
        .register({
          email: user.email,
          password: 'Passw0rd!',
          name: '홍길동',
          phoneNumber: '010-0000-0000',
        })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('SOCIAL_ACCOUNT_EXISTS');
      expect(archiveOrphanProfile).not.toHaveBeenCalled();
      expect(createUser).not.toHaveBeenCalled();
    });

    it('소셜 회원의 비밀번호 변경 → 400 SOCIAL_ACCOUNT_NO_PASSWORD', async () => {
      socialFindOne.mockResolvedValue(linked);

      const error = await service
        .changePassword({
          userId: 7,
          currentPassword: 'x',
          newPassword: 'Passw0rd!',
        })
        .catch((e: unknown) => e);

      expect(parseApiRpcError(error)).toMatchObject({
        status: 400,
        code: 'SOCIAL_ACCOUNT_NO_PASSWORD',
      });
    });
  });
});

describe('KakaoOAuthClient 회원 정보', () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeAll(() => {
    global.fetch = fetchMock;
    process.env.KAKAO_CLIENT_ID = 'test-kakao-key';
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const respond = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('인증되지 않은 이메일은 쓰지 않는다 (email: null)', async () => {
    fetchMock
      .mockReturnValueOnce(respond({ access_token: 'at' }))
      .mockReturnValueOnce(
        respond({
          id: 12345,
          kakao_account: {
            email: 'someone@t.com',
            is_email_valid: true,
            is_email_verified: false,
            profile: { nickname: '닉' },
          },
        }),
      );

    const profile = await new KakaoOAuthClient().getProfile(
      'code',
      'http://localhost:5174/cb',
    );

    expect(profile).toEqual({ id: '12345', email: null, nickname: '닉' });
  });

  const failure = (code: string) =>
    new KakaoOAuthClient().getProfile(code, 'x').catch((e: unknown) => e);

  it('인가 코드가 틀리거나 이미 쓴 코드(invalid_grant)면 401 SOCIAL_LOGIN_FAILED', async () => {
    fetchMock.mockReturnValueOnce(
      respond({ error: 'invalid_grant', error_code: 'KOE320' }, 400),
    );

    expect(parseApiRpcError(await failure('bad'))).toMatchObject({
      status: 401,
      code: 'SOCIAL_LOGIN_FAILED',
    });
  });

  it('앱 키·시크릿·Redirect URI 설정 오류(그 밖의 4xx)는 사용자 실패로 숨기지 않고 503', async () => {
    fetchMock
      .mockReturnValueOnce(
        respond({ error: 'invalid_client', error_code: 'KOE010' }, 401),
      )
      .mockReturnValueOnce(
        respond({ error: 'invalid_grant', error_code: 'KOE303' }, 400),
      )
      .mockReturnValueOnce(respond({ access_token: 'at' }))
      .mockReturnValueOnce(
        respond({ msg: 'this access token does not exist', code: -401 }, 401),
      );

    for (let i = 0; i < 3; i++) {
      expect(parseApiRpcError(await failure('code'))).toMatchObject({
        status: 503,
        code: 'SOCIAL_PROVIDER_UNAVAILABLE',
      });
    }
  });

  it('카카오 장애(5xx)면 503 SOCIAL_PROVIDER_UNAVAILABLE', async () => {
    fetchMock.mockReturnValueOnce(respond({}, 502));

    expect(parseApiRpcError(await failure('code'))).toMatchObject({
      status: 503,
      code: 'SOCIAL_PROVIDER_UNAVAILABLE',
    });
  });
});
