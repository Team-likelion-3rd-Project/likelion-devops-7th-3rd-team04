import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Observable, firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import {
  REDIS_CLIENT,
  JwtPayload,
  PrincipalType,
  apiRpcException,
  getRequiredEnv,
  errorTrace,
} from '@app/common';
import { Credential } from './entities/credential.entity';
import { AdminCredential } from './entities/admin-credential.entity';

const SALT_ROUNDS = 10;

// 이메일/비밀번호 불일치와 미가입 이메일을 동일 메시지로 응답해 계정 존재 여부가 노출되지 않도록 합니다.
const INVALID_CREDENTIALS_MESSAGE = '이메일 또는 비밀번호가 일치하지 않습니다.';
const INVALID_REFRESH_TOKEN_MESSAGE = '유효하지 않거나 만료된 리프레시 토큰입니다.';
const INVALID_CURRENT_PASSWORD_MESSAGE = '현재 비밀번호가 일치하지 않습니다.';

// Redis에 리프레시 토큰을 저장하는 키. principal 타입(user/admin)별로 네임스페이싱해서, users.id와
// admins.id가 같은 숫자여도(예: 둘 다 5) 리프레시 토큰이 서로 덮어쓰이지 않도록 합니다.
// 1 principal당 1개만 유지하며(재로그인 시 이전 토큰은 자동 무효화), 로그아웃 시 이 키를 삭제하면
// 이후 Refresh 요청이 거부됩니다.
const refreshTokenKey = (type: PrincipalType, id: number) =>
  `refresh:${type.toLowerCase()}:${id}`;

// 절대 만료 판단용 "최초 로그인 시각"(epoch seconds)을 저장하는 키. 로그인/회원가입 시에만
// 새로 세팅되고, refresh()에 의한 로테이션에서는 건드리지 않는다 — 그래야 로테이션을 반복해도
// 세션이 무한정 연장되지 않고 최초 로그인으로부터 JWT_REFRESH_ABSOLUTE_MAX_DAYS가 지나면 끊긴다.
// TTL을 절대 상한과 동일하게 주면 슬라이딩(refresh)으로 refreshTokenKey는 계속 살아있는데 이 키만
// 먼저 자연 소멸해버려 "누락 = 관대하게 재세팅"과 구분이 안 되고 상한이 무한정 밀리는 문제가 생긴다.
// 그래서 TTL을 두지 않고(영구), 상한 도달 시 assertWithinAbsoluteLifetime()이 명시적으로 지우거나
// logout/withdraw/changePassword에서 refreshTokenKey와 함께 정리한다.
const issuedAtKey = (type: PrincipalType, id: number) =>
  `refresh:issuedAt:${type.toLowerCase()}:${id}`;

// 로테이션 직후 "방금 버려진" 직전 리프레시 토큰을 잠시 보관하는 키(TTL: REFRESH_GRACE_TTL_SECONDS).
// 브라우저가 로테이션 응답(Set-Cookie)을 받기 전에 페이지가 새로고침되어 요청이 끊기면, 브라우저
// 쿠키는 구 토큰(직전 값)에 머무르게 됩니다. 이 짧은 유예 구간 안에 그 구 토큰으로 재시도가 들어오면
// 공격이 아니라 이 경쟁 상태로 보고, 재로테이션 없이 현재 유효한 토큰을 그대로 돌려줍니다(refresh()
// 참고, 연쇄 로테이션 방지). SALT_ROUNDS와 마찬가지로 배포 환경별로 달라질 값이 아니라 보안 로직에
// 고정된 튜닝값이라 env가 아닌 상수로 관리합니다.
const REFRESH_GRACE_TTL_SECONDS = 20;

const refreshGraceKey = (type: PrincipalType, id: number) =>
  `refresh:grace:${type.toLowerCase()}:${id}`;

// libs/common/src/proto/user.proto의 User 메시지와 1:1 대응
interface UserGrpcResponse {
  id: number;
  email: string;
  name: string;
  phoneNumber: string;
  role: string;
  status: string;
}

// libs/common/src/proto/user.proto의 Admin 메시지와 1:1 대응
interface AdminGrpcResponse {
  id: number;
  email: string;
  name: string;
}

interface UserGrpcService {
  createUser(data: { email: string; name: string; phoneNumber: string }): Observable<UserGrpcResponse>;
  getUserByEmail(data: { email: string }): Observable<UserGrpcResponse>;
  deleteUser(data: { id: number }): Observable<{ success: boolean }>;
  cancelSignup(data: { id: number; email: string }): Observable<{ success: boolean }>;
  archiveOrphanProfile(data: { id: number; email: string }): Observable<{ success: boolean }>;
}

interface AdminGrpcService {
  getAdminByEmail(data: { email: string }): Observable<AdminGrpcResponse>;
}

// libs/common/src/proto/booking.proto의 BookingService / CountUpcomingReservations (LDP-95)
interface BookingGrpcService {
  countUpcomingReservations(data: { userId: number }): Observable<{ count: number }>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  userId: number;
  email: string;
  name: string;
  role: string;
}

// 토큰 발급 대상(고객 또는 관리자)을 표현하는 공통 형태. issueTokens()가 principal 종류와 무관하게
// 동일한 방식으로 토큰을 만들 수 있도록 login()/adminLogin()/refresh()에서 이 형태로 변환해 넘깁니다.
interface Principal {
  id: number;
  email: string;
  name: string;
  role: string;
  type: PrincipalType;
}

@Injectable()
export class AuthServiceService implements OnModuleInit {
  private readonly logger = new Logger(AuthServiceService.name);
  private userService!: UserGrpcService;
  private adminService!: AdminGrpcService;
  private bookingService!: BookingGrpcService;

  constructor(
    @InjectRepository(Credential)
    private readonly credentialRepository: Repository<Credential>,
    @InjectRepository(AdminCredential)
    private readonly adminCredentialRepository: Repository<AdminCredential>,
    private readonly jwtService: JwtService,
    @Inject('USER_SERVICE') private readonly userClient: ClientGrpc,
    @Inject('BOOKING_SERVICE') private readonly bookingClient: ClientGrpc,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    // user.proto 한 파일 안에 UserService(고객)와 AdminService(관리자)가 함께 정의되어 있어
    // 같은 gRPC 클라이언트에서 서비스 이름만 다르게 꺼내 씁니다.
    this.userService =
      this.userClient.getService<UserGrpcService>('UserService');
    this.adminService =
      this.userClient.getService<AdminGrpcService>('AdminService');
    this.bookingService =
      this.bookingClient.getService<BookingGrpcService>('BookingService');
  }

  // 회원가입: user-service에 프로필 생성 → 비밀번호 해시 저장 → 토큰 발급
  async register(data: {
    email: string;
    password: string;
    name: string;
    phoneNumber: string;
  }): Promise<AuthTokens> {
    await this.archiveOrphanProfile(data.email);

    const user = await firstValueFrom(
      this.userService.createUser({
        email: data.email,
        name: data.name,
        phoneNumber: data.phoneNumber,
      }),
    ).catch((err) => {
      // user-service가 이메일 중복 등으로 던진 RpcException 메시지를 그대로 전달
      throw new RpcException(
        err?.details || err?.message || '회원가입에 실패했습니다.',
      );
    });

    // 프로필(user-service)과 비밀번호(이 서비스)는 DB가 달라 한 트랜잭션으로 묶을 수 없습니다 (LDP-96).
    // 비밀번호 저장에 실패하면 방금 만든 프로필을 되돌려, 같은 이메일로 다시 가입할 수 있게 합니다.
    try {
      const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
      await this.credentialRepository.save(
        this.credentialRepository.create({ userId: user.id, passwordHash }),
      );
    } catch (error) {
      this.logger.error(
        `회원가입 비밀번호 저장 실패 (userId=${user.id}) — 프로필 되돌림`,
        errorTrace(error),
      );
      await firstValueFrom(this.userService.cancelSignup({ id: user.id, email: user.email })).catch((cancelError) => {
        // 되돌리기도 실패하면 프로필만 남는다 — 이 이메일은 운영자가 정리해야 다시 가입할 수 있다
        this.logger.error(
          `[알람] 회원가입 프로필 되돌리기 실패 (userId=${user.id}) — 수동 정리 필요`,
          errorTrace(cancelError),
        );
      });
      throw apiRpcException({
        status: 503,
        code: 'SIGNUP_FAILED',
        message: '회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        retryable: true,
      });
    }

    // 여기까지 오면 가입은 끝났습니다. 토큰 발급(Valkey 저장)만 실패하면 가입 실패가 아니라
    // "가입 완료, 로그인 필요"로 알려 줍니다 — 같은 이메일로 다시 가입하면 "이미 가입된 이메일"이 되기 때문입니다.
    try {
      return await this.issueTokens({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        type: 'USER',
      });
    } catch (error) {
      this.logger.error(
        `회원가입 후 토큰 발급 실패 (userId=${user.id}) — 가입은 완료`,
        errorTrace(error),
      );
      throw apiRpcException({
        status: 503,
        code: 'SIGNUP_COMPLETED_LOGIN_REQUIRED',
        message: '회원가입은 완료되었습니다. 잠시 후 로그인해 주세요.',
        retryable: false,
      });
    }
  }

  // 탈퇴가 중간에 멈춰 비밀번호 없이 프로필만 남은 이메일이면, 가입 전에 그 프로필을 deleted_user로 정리합니다 (LDP-111).
  // 비밀번호가 없으면 로그인도 탈퇴 재시도도 할 수 없어, 정리하지 않으면 이 이메일로 다시 가입할 방법이 없습니다.
  // 만든 지 얼마 안 된 프로필(가입 진행 중)은 user-service가 건드리지 않습니다. 정리하지 못하면 아무것도 하지 않고,
  // 이어지는 createUser가 기존처럼 "이미 가입된 이메일입니다."로 응답합니다 — 이 단계 실패로 가입이 막히지는 않습니다.
  private async archiveOrphanProfile(email: string): Promise<void> {
    try {
      const existing = await firstValueFrom(
        this.userService.getUserByEmail({ email }),
      ).catch(() => null);
      if (!existing) {
        return;
      }
      const credential = await this.credentialRepository.findOne({
        where: { userId: existing.id },
      });
      if (credential) {
        return;
      }
      const { success } = await firstValueFrom(
        this.userService.archiveOrphanProfile({ id: existing.id, email }),
      );
      if (success) {
        this.logger.warn(
          `비밀번호 없이 남은 프로필을 deleted_user로 정리하고 재가입 진행 (이전 userId=${existing.id})`,
        );
      }
    } catch (error) {
      this.logger.error(
        '남은 프로필 정리 실패 — 가입은 기존대로 진행',
        errorTrace(error),
      );
    }
  }

  // 로그인(고객): user-service에서 이메일로 프로필 조회 → 비밀번호 해시 검증 → 토큰 발급
  async login(data: { email: string; password: string }): Promise<AuthTokens> {
    const user = await firstValueFrom(this.userService.getUserByEmail({ email: data.email })).catch(() => {
      // 미가입 이메일도 동일한 메시지로 응답 (계정 존재 여부 비노출)
      throw new RpcException(INVALID_CREDENTIALS_MESSAGE);
    });

    const credential = await this.credentialRepository.findOne({ where: { userId: user.id } });
    if (!credential) {
      throw new RpcException(INVALID_CREDENTIALS_MESSAGE);
    }

    const isPasswordValid = await bcrypt.compare(data.password, credential.passwordHash);
    if (!isPasswordValid) {
      throw new RpcException(INVALID_CREDENTIALS_MESSAGE);
    }

    return this.issueTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      type: 'USER',
    });
  }

  // 로그인(관리자): user-service의 AdminService에서 이메일로 관리자 계정 조회 → 비밀번호 해시 검증(AdminCredential)
  // → 토큰 발급. 고객과 완전히 다른 테이블(admins/admin_credentials)을 본다는 점만 다르고, 이후 토큰
  // 발급/검증(@Roles·RolesGuard 등) 로직은 login()과 동일하게 재사용됩니다.
  async adminLogin(data: { email: string; password: string }): Promise<AuthTokens> {
    const admin = await firstValueFrom(this.adminService.getAdminByEmail({ email: data.email })).catch(() => {
      // 미등록 이메일도 동일한 메시지로 응답 (계정 존재 여부 비노출)
      throw new RpcException(INVALID_CREDENTIALS_MESSAGE);
    });

    const credential = await this.adminCredentialRepository.findOne({ where: { adminId: admin.id } });
    if (!credential) {
      throw new RpcException(INVALID_CREDENTIALS_MESSAGE);
    }

    const isPasswordValid = await bcrypt.compare(data.password, credential.passwordHash);
    if (!isPasswordValid) {
      throw new RpcException(INVALID_CREDENTIALS_MESSAGE);
    }

    return this.issueTokens({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: 'ADMIN',
      type: 'ADMIN',
    });
  }

  // 토큰 재발급: 리프레시 토큰 서명 검증 → Redis에 저장된 값과 대조 → payload.type에 따라 고객/관리자
  // 프로필을 다시 조회해 최신 정보로 토큰을 재발급(로테이션)합니다.
  // 로그아웃된(= Redis에서 삭제된) 리프레시 토큰은 서명이 유효해도 거부됩니다.
  async refresh(data: { refreshToken: string }): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(data.refreshToken, {
        secret: getRequiredEnv('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new RpcException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // 로테이션/grace 어느 경로든 절대 만료 상한을 넘긴 세션은 여기서 끊는다(강제 재로그인 유도).
    await this.assertWithinAbsoluteLifetime(payload.type, payload.sub);

    const storedToken = await this.redis.get(refreshTokenKey(payload.type, payload.sub));

    if (storedToken && storedToken === data.refreshToken) {
      // 최신 프로필(이름/권한 변경 등)을 반영해 토큰을 재발급(로테이션)합니다.
      const principal = await this.resolvePrincipal(payload);
      return this.issueTokens(principal, { previousToken: storedToken });
    }

    // 새로고침 연타 등으로 이미 로테이션되어 버려진 "직전" 토큰이 뒤늦게 재시도로 들어온 경우입니다.
    // grace 키에 남아있다면 공격이 아니라 이 경쟁 상태로 보고, 재로테이션 없이(연쇄 로테이션 방지)
    // 이미 로테이션된 현재 유효한 리프레시 토큰을 그대로 돌려줍니다. 액세스 토큰만 새로 발급합니다.
    if (storedToken) {
      const graceToken = await this.redis.get(refreshGraceKey(payload.type, payload.sub));
      if (graceToken === data.refreshToken) {
        const principal = await this.resolvePrincipal(payload);
        return {
          accessToken: this.signAccessToken(principal),
          refreshToken: storedToken,
          userId: principal.id,
          email: principal.email,
          name: principal.name,
          role: principal.role,
        };
      }
    }

    throw new RpcException(INVALID_REFRESH_TOKEN_MESSAGE);
  }

  // 최초 로그인으로부터 JWT_REFRESH_ABSOLUTE_MAX_DAYS가 지났으면 로테이션/grace를 막고 세션을 끊는다.
  // issuedAt이 없는 경우(이 기능 배포 이전에 이미 로그인해 있던 세션 등)는 관대하게 지금을 기준으로
  // 새로 세팅하고 통과시킨다 — 배포 직후 기존 세션이 전부 강제 로그아웃되는 것을 피하기 위함이다.
  private async assertWithinAbsoluteLifetime(type: PrincipalType, id: number): Promise<void> {
    const issuedAtRaw = await this.redis.get(issuedAtKey(type, id));
    if (!issuedAtRaw) {
      await this.recordIssuedAt(type, id);
      return;
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - Number(issuedAtRaw);
    if (ageSeconds <= this.getAbsoluteMaxAgeSeconds()) {
      return;
    }

    await this.redis.del(refreshTokenKey(type, id));
    await this.redis.del(refreshGraceKey(type, id));
    await this.redis.del(issuedAtKey(type, id));
    throw new RpcException(INVALID_REFRESH_TOKEN_MESSAGE);
  }

  private getAbsoluteMaxAgeSeconds(): number {
    const days = Number(getRequiredEnv('JWT_REFRESH_ABSOLUTE_MAX_DAYS'));
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error('JWT_REFRESH_ABSOLUTE_MAX_DAYS 형식이 올바르지 않습니다.');
    }
    return days * 24 * 60 * 60;
  }

  // 로그인/회원가입(최초 세션) 시에만 호출됩니다 — 절대 만료의 기준 시각을 지금으로 새로 세팅합니다.
  private async recordIssuedAt(type: PrincipalType, id: number): Promise<void> {
    await this.redis.set(issuedAtKey(type, id), String(Math.floor(Date.now() / 1000)));
  }

  // refresh()의 정상 로테이션 경로와 grace 경로 양쪽에서 공통으로 쓰는, payload → 최신 프로필 조회.
  // 탈퇴/삭제 등으로 프로필을 더 이상 찾을 수 없으면 리프레시 토큰도 무효로 취급합니다.
  private async resolvePrincipal(payload: JwtPayload): Promise<Principal> {
    if (payload.type === 'ADMIN') {
      const admin = await firstValueFrom(this.adminService.getAdminByEmail({ email: payload.email })).catch(() => {
        throw new RpcException(INVALID_REFRESH_TOKEN_MESSAGE);
      });
      return { id: admin.id, email: admin.email, name: admin.name, role: 'ADMIN', type: 'ADMIN' };
    }

    const user = await firstValueFrom(this.userService.getUserByEmail({ email: payload.email })).catch(() => {
      throw new RpcException(INVALID_REFRESH_TOKEN_MESSAGE);
    });
    return { id: user.id, email: user.email, name: user.name, role: user.role, type: 'USER' };
  }

  // 로그아웃: Redis에서 리프레시 토큰을 삭제합니다. JWT는 무상태이므로 이미 발급된 액세스 토큰은
  // (기본 15분) 만료 시점까지는 계속 유효하지만, Refresh를 통한 재발급은 즉시 차단됩니다.
  // type으로 고객/관리자 중 어느 쪽 리프레시 토큰을 지울지 구분합니다(Redis 키 네임스페이싱).
  async logout(data: { userId: number; type: PrincipalType }): Promise<{ success: boolean }> {
    await this.redis.del(refreshTokenKey(data.type, data.userId));
    // grace 키도 같이 지웁니다 — 안 지우면 로그아웃 직후 도착한 지연된 구 토큰이 grace 구간 동안은
    // 여전히 통과되어 로그아웃이 즉시 반영되지 않는 구멍이 생깁니다.
    await this.redis.del(refreshGraceKey(data.type, data.userId));
    // issuedAt(절대 만료 기준 시각)도 같이 지웁니다. TTL이 없는 키라 로그아웃 후 재로그인하지
    // 않으면 계속 남아있으므로, 다른 키들과 마찬가지로 세션 종료 시점에 명시적으로 정리합니다.
    await this.redis.del(issuedAtKey(data.type, data.userId));
    return { success: true };
  }

  // 비밀번호 변경(고객 전용): 현재 비밀번호 검증 → 새 비밀번호로 해시 교체 → 다른 기기/세션 강제 재로그인(리프레시 토큰 삭제)
  async changePassword(data: {
    userId: number;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean }> {
    const credential = await this.credentialRepository.findOne({ where: { userId: data.userId } });
    if (!credential) {
      throw new RpcException(INVALID_CURRENT_PASSWORD_MESSAGE);
    }

    const isCurrentPasswordValid = await bcrypt.compare(data.currentPassword, credential.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new RpcException(INVALID_CURRENT_PASSWORD_MESSAGE);
    }

    credential.passwordHash = await bcrypt.hash(data.newPassword, SALT_ROUNDS);
    await this.credentialRepository.save(credential);

    // 비밀번호가 바뀌었으므로 기존에 발급된 리프레시 토큰은 무효화합니다(다른 기기/세션은 재로그인 필요).
    await this.redis.del(refreshTokenKey('USER', data.userId));
    await this.redis.del(refreshGraceKey('USER', data.userId));
    await this.redis.del(issuedAtKey('USER', data.userId));

    return { success: true };
  }

  // 회원 탈퇴(고객 전용). 이용 예정 예약이 있으면 아무것도 지우기 전에 거절합니다 (LDP-95, 10-19 결정) — 탈퇴해도
  // 예약이 남아 재고를 차지하고, 직원은 누구 예약인지 알 수 없게 되기 때문입니다.
  // 지우는 순서 (LDP-96): 로그인 세션(Valkey) → 비밀번호 → 프로필(deleted_user로 이관)을 마지막에.
  //  - 서비스·저장소가 셋으로 나뉘어 한 번에 묶을 수 없으므로, 앞 단계부터 지우고 각 단계는 다시 실행해도 안전하게
  //    했습니다(이미 지워졌으면 그냥 넘어감). 중간에 실패해도 같은 요청을 다시 보내면 끝까지 처리됩니다.
  //  - 프로필을 마지막에 두는 이유: 프로필이 먼저 사라지면 남은 비밀번호·세션을 찾아 지울 근거가 없어집니다.
  async withdraw(data: { userId: number }): Promise<{ success: boolean }> {
    await this.assertNoUpcomingReservations(data.userId);

    try {
      await this.redis.del(refreshTokenKey('USER', data.userId));
      await this.redis.del(refreshGraceKey('USER', data.userId));
      await this.redis.del(issuedAtKey('USER', data.userId));
      await this.credentialRepository.delete({ userId: data.userId });
    } catch (error) {
      this.logger.error(
        `회원 탈퇴 중 세션·비밀번호 삭제 실패 (userId=${data.userId})`,
        errorTrace(error),
      );
      throw this.withdrawIncomplete();
    }

    await firstValueFrom(this.userService.deleteUser({ id: data.userId })).catch((err) => {
      // 이전 요청에서 프로필 이관까지 끝났는데 응답만 못 받은 경우 — 이미 탈퇴된 것이므로 성공으로 본다
      if (err?.details?.includes('존재하지 않는')) {
        return;
      }
      this.logger.error(`회원 탈퇴 중 프로필 이관 실패 (userId=${data.userId})`, errorTrace(err));
      throw this.withdrawIncomplete();
    });

    return { success: true };
  }

  // 탈퇴가 중간에 멈춤 — 같은 요청을 다시 보내면 남은 단계부터 끝까지 처리된다
  private withdrawIncomplete() {
    return apiRpcException({
      status: 503,
      code: 'WITHDRAW_INCOMPLETE',
      message: '탈퇴 처리를 마치지 못했습니다. 잠시 후 다시 시도해 주세요.',
      retryable: true,
    });
  }

  // 이용 예정 예약(결제 대기 전부 + 체크아웃이 오늘 이후인 확정 예약)이 있으면 409.
  // 예약 서비스에 연결할 수 없으면 확인하지 못한 채 지우지 않도록 503으로 멈춥니다.
  private async assertNoUpcomingReservations(userId: number): Promise<void> {
    const { count } = await firstValueFrom(this.bookingService.countUpcomingReservations({ userId })).catch(() => {
      throw apiRpcException({
        status: 503,
        code: 'BOOKING_SERVICE_UNAVAILABLE',
        message: '예약 정보를 확인할 수 없어 탈퇴를 진행하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        retryable: true,
      });
    });
    if (count > 0) {
      throw apiRpcException({
        status: 409,
        code: 'HAS_UPCOMING_RESERVATIONS',
        message: `이용 예정 예약이 ${count}건 있어 탈퇴할 수 없습니다. 예약을 먼저 취소해 주세요.`,
        retryable: false,
      });
    }
  }

  private signAccessToken(principal: Principal): string {
    const payload: JwtPayload = {
      sub: principal.id,
      email: principal.email,
      role: principal.role,
      type: principal.type,
    };
    return this.jwtService.sign(payload, {
      secret: getRequiredEnv('JWT_ACCESS_SECRET'),
      expiresIn: getRequiredEnv(
        'JWT_ACCESS_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  // previousToken이 있으면(= refresh()의 정상 로테이션 경로) 덮어쓰기 전에 그 값을 grace 키로
  // 옮겨둡니다. login()/register()는 previousToken 없이 호출해, 이전 세션이 즉시 무효화되는
  // 기존 동작을 그대로 유지합니다.
  private async issueTokens(
    principal: Principal,
    options?: { previousToken?: string },
  ): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: principal.id,
      email: principal.email,
      role: principal.role,
      type: principal.type,
    };

    const accessToken = this.signAccessToken(principal);
    const refreshToken = this.jwtService.sign(payload, {
      secret: getRequiredEnv('JWT_REFRESH_SECRET'),
      expiresIn: getRequiredEnv(
        'JWT_REFRESH_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
    });

    if (options?.previousToken) {
      // 로테이션 경로: issuedAt(절대 만료 기준 시각)은 여기서 건드리지 않는다 — 최초 로그인
      // 시각을 그대로 유지해야 로테이션을 반복해도 절대 상한이 계속 밀리지 않는다.
      await this.redis.set(
        refreshGraceKey(principal.type, principal.id),
        options.previousToken,
        'EX',
        REFRESH_GRACE_TTL_SECONDS,
      );
    } else {
      // 최초 로그인/재로그인 경로: 절대 만료 기준 시각을 지금으로 새로 세팅한다.
      await this.recordIssuedAt(principal.type, principal.id);
    }

    // 리프레시 토큰의 TTL을 JWT의 실제 만료 시각(exp)에 맞춰 Redis에 저장합니다
    // (principal당 1개, 재로그인 시 덮어씀. 키는 principal 타입별로 네임스페이싱되어 있음).
    const { exp } = this.jwtService.decode<{ exp: number }>(refreshToken);
    const ttlSeconds = Math.max(exp - Math.floor(Date.now() / 1000), 1);
    await this.redis.set(
      refreshTokenKey(principal.type, principal.id),
      refreshToken,
      'EX',
      ttlSeconds,
    );

    return {
      accessToken,
      refreshToken,
      userId: principal.id,
      email: principal.email,
      name: principal.name,
      role: principal.role,
    };
  }
}
