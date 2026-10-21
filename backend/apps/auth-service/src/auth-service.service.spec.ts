import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { of } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { REDIS_CLIENT } from '@app/common';
import { AuthServiceService } from './auth-service.service';
import { Credential } from './entities/credential.entity';
import { AdminCredential } from './entities/admin-credential.entity';

// #3 절대 만료: 로테이션(refresh)을 반복해도 최초 로그인으로부터 JWT_REFRESH_ABSOLUTE_MAX_DAYS가
// 지나면 세션이 강제로 끊기는지 검증합니다. issueTokens()가 매번 now + JWT_REFRESH_EXPIRES_IN으로만
// 만료를 계산하던(=슬라이딩) 이전 동작이었다면 아래 "상한 초과" 케이스가 통과되어 버립니다.
describe('AuthServiceService - 절대 만료', () => {
  let service: AuthServiceService;

  const getUserByEmailMock = jest.fn();
  const createUserMock = jest.fn();
  const redisGet = jest.fn<Promise<string | null>, [string]>();
  const redisSet = jest.fn<Promise<string>, [string, string]>();
  const redisDel = jest.fn<Promise<number>, [string]>();

  const user = {
    id: 1,
    email: 'user@example.com',
    name: '홍길동',
    phoneNumber: '010-0000-0000',
    role: 'USER',
    status: 'ACTIVE',
  };

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.JWT_REFRESH_ABSOLUTE_MAX_DAYS = '30';
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    getUserByEmailMock.mockReturnValue(of(user));
    createUserMock.mockReturnValue(of(user));
    redisSet.mockResolvedValue('OK');
    redisDel.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthServiceService,
        JwtService,
        { provide: getRepositoryToken(Credential), useValue: {} },
        { provide: getRepositoryToken(AdminCredential), useValue: {} },
        {
          provide: 'USER_SERVICE',
          useValue: {
            getService: () => ({
              getUserByEmail: getUserByEmailMock,
              getAdminByEmail: jest.fn(),
              createUser: createUserMock,
            }),
          },
        },
        { provide: 'BOOKING_SERVICE', useValue: { getService: () => ({}) } },
        { provide: REDIS_CLIENT, useValue: { get: redisGet, set: redisSet, del: redisDel } },
      ],
    }).compile();

    service = module.get<AuthServiceService>(AuthServiceService);
    service.onModuleInit();
  });

  // 실제 refresh()가 검증할 수 있는 서명된 리프레시 토큰을 만들어주는 헬퍼.
  function signRefreshToken(): string {
    const jwt = new JwtService({});
    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role, type: 'USER' },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN as JwtSignOptions['expiresIn'],
      },
    );
  }

  const refreshTokenKey = 'refresh:user:1';
  const issuedAtKey = 'refresh:issuedAt:user:1';

  it('로그인 시 issuedAt(절대 만료 기준 시각)을 새로 기록한다', async () => {
    getUserByEmailMock.mockReturnValue(of(user));
    // login()은 credentialRepository.findOne으로 비밀번호 해시를 조회하므로 여기서는 직접
    // register()를 검증한다 — register는 credentialRepository.save만 호출한다.
    const credentialRepo = { create: (v: unknown) => v, save: jest.fn() };
    (service as unknown as { credentialRepository: unknown }).credentialRepository = credentialRepo;

    const before = Math.floor(Date.now() / 1000);
    await service.register({
      email: user.email,
      password: 'pw123456',
      name: user.name,
      phoneNumber: user.phoneNumber,
    });

    expect(redisSet).toHaveBeenCalledWith(issuedAtKey, expect.any(String));
    const [, storedValue] = redisSet.mock.calls.find(([key]) => key === issuedAtKey)!;
    expect(Number(storedValue)).toBeGreaterThanOrEqual(before);
  });

  it('절대 상한(30일) 이내면 로테이션을 허용하고, issuedAt은 그대로 유지한다', async () => {
    const refreshToken = signRefreshToken();
    const issuedAtSecondsAgo = 10 * 24 * 60 * 60; // 10일 전 로그인
    redisGet.mockImplementation((key: string) => {
      if (key === refreshTokenKey) return Promise.resolve(refreshToken);
      if (key === issuedAtKey) {
        return Promise.resolve(String(Math.floor(Date.now() / 1000) - issuedAtSecondsAgo));
      }
      return Promise.resolve(null);
    });

    const result = await service.refresh({ refreshToken });

    expect(result.accessToken).toBeDefined();
    // 로테이션 경로에서는 issuedAt 키를 다시 SET하지 않아야 한다(최초 로그인 시각 유지).
    expect(redisSet).not.toHaveBeenCalledWith(issuedAtKey, expect.anything());
  });

  it('절대 상한(30일)을 넘기면 로테이션을 거부하고 세션 관련 키를 모두 정리한다', async () => {
    const refreshToken = signRefreshToken();
    const issuedAtSecondsAgo = 31 * 24 * 60 * 60; // 31일 전 로그인 → 상한(30일) 초과
    redisGet.mockImplementation((key: string) => {
      if (key === refreshTokenKey) return Promise.resolve(refreshToken);
      if (key === issuedAtKey) {
        return Promise.resolve(String(Math.floor(Date.now() / 1000) - issuedAtSecondsAgo));
      }
      return Promise.resolve(null);
    });

    await expect(service.refresh({ refreshToken })).rejects.toThrow(RpcException);

    expect(redisDel).toHaveBeenCalledWith(refreshTokenKey);
    expect(redisDel).toHaveBeenCalledWith(issuedAtKey);
  });

  it('issuedAt이 없으면(배포 이전 기존 세션) 관대하게 지금 시각으로 새로 기록하고 로테이션을 허용한다', async () => {
    const refreshToken = signRefreshToken();
    redisGet.mockImplementation((key: string) => {
      if (key === refreshTokenKey) return Promise.resolve(refreshToken);
      return Promise.resolve(null); // issuedAt 없음
    });

    const result = await service.refresh({ refreshToken });

    expect(result.accessToken).toBeDefined();
    expect(redisSet).toHaveBeenCalledWith(issuedAtKey, expect.any(String));
  });
});