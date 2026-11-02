import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  OnModuleInit,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import ms from 'ms';
import { ApiCommonResponses } from '@app/common/decorators/api-response.decorator';
import {
  JwtAuthGuard,
  CurrentUser,
  AuthenticatedUser,
  PrincipalType,
  getRequiredEnv,
  grpcErrorToHttp,
  parseApiRpcError,
  toHttpException,
} from '@app/common';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { SocialSignupDto } from './dto/social-signup.dto';

interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  userId: number;
  email: string;
  name: string;
  role: string;
  socialProvider: string; // 소셜 회원이면 'KAKAO', 아니면 '' (LDP-194)
}

interface SocialLoginResponse {
  signupRequired: boolean;
  signupToken: string;
  email: string;
  name: string;
  auth?: AuthTokenResponse | null;
}

// 리프레시 토큰은 httpOnly 쿠키로만 전달하고, 응답 바디에는 액세스 토큰 + 사용자 정보만 내려줍니다.
// 액세스 토큰은 프론트엔드가 메모리(변수)에만 보관하고, 리프레시 토큰(쿠키)으로 재발급받습니다.
type AuthClientResponse = Omit<AuthTokenResponse, 'refreshToken'>;

// proto의 AuthService 스펙과 1:1 대응되는 TS 인터페이스
interface AuthService {
  register(data: RegisterDto): Observable<AuthTokenResponse>;
  login(data: LoginDto): Observable<AuthTokenResponse>;
  adminLogin(data: LoginDto): Observable<AuthTokenResponse>;
  refresh(data: RefreshDto): Observable<AuthTokenResponse>;
  logout(data: {
    userId: number;
    type: AuthenticatedUser['type'];
  }): Observable<{ success: boolean }>;
  changePassword(data: {
    userId: number;
    currentPassword: string;
    newPassword: string;
  }): Observable<{ success: boolean }>;
  socialAuthorizeUrl(data: {
    provider: string;
    redirectUri: string;
  }): Observable<{ url: string; state: string }>;
  socialLogin(data: {
    provider: string;
    code: string;
    state: string;
  }): Observable<SocialLoginResponse>;
  socialSignup(data: SocialSignupDto): Observable<AuthTokenResponse>;
}

// 리프레시 토큰 쿠키는 브라우저 JS가 절대 읽을 수 없도록 httpOnly로 발급합니다 (XSS로 인한 탈취 방지).
// 개발(HTTP)/운영(HTTPS)을 함께 지원하기 위해 secure는 NODE_ENV 기준으로 분기합니다.
//
// 고객(refreshToken)과 관리자(adminRefreshToken)는 이름이 다른 쿠키를 씁니다. 이름이 같으면
// 브라우저에는 (domain, path, name) 조합당 쿠키가 1개만 존재할 수 있어서, 관리자로 로그인한 뒤
// 고객으로(또는 그 반대로) 로그인하면 먼저 발급된 쿠키가 나중 로그인으로 덮어써져 버립니다.
// 이름을 분리하면 두 세션의 리프레시 토큰이 브라우저에 동시에 공존하며 서로 간섭하지 않습니다.
const REFRESH_COOKIE_NAME: Record<PrincipalType, string> = {
  USER: 'refreshToken',
  ADMIN: 'adminRefreshToken',
};
const COOKIE_BASE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

// 카카오 로그인 state를 이 브라우저에 묶어 두는 쿠키 (LDP-194). 인가 화면 주소를 받을 때 심고, 돌아와서 로그인할 때
// 본문의 state와 같은지 본다 — 다른 사람이 만든 카카오 로그인 링크를 눌러 그 사람 계정으로 로그인되는 것을 막는다.
const SOCIAL_STATE_COOKIE_NAME = 'socialState';
const SOCIAL_STATE_MAX_AGE_MS = 10 * 60 * 1000; // auth-service의 state 보관 시간과 같음

// gRPC로 받은 실패를 HTTP로 (LDP-198과 같은 규칙) — { code, retryable } 형식은 그대로, 요청 쪽 문제(중복 이메일 등)는 4xx,
// auth-service·Valkey 장애처럼 서버 쪽 문제는 503 AUTH_SERVICE_UNAVAILABLE
function toSocialHttpError(err: unknown, unavailableMessage: string) {
  return grpcErrorToHttp(err, {
    code: 'AUTH_SERVICE_UNAVAILABLE',
    message: unavailableMessage,
  });
}

@ApiTags('AuthService')
@ApiCommonResponses()
@Controller('api/auth')
export class AuthController implements OnModuleInit {
  private authService!: AuthService;

  constructor(@Inject('AUTH_SERVICE') private readonly client: ClientGrpc) {}

  // NestJS 생명주기: 모듈이 초기화될 때 gRPC 서비스 객체를 추출합니다.
  onModuleInit() {
    this.authService = this.client.getService<AuthService>('AuthService');
  }

  // 리프레시 토큰만 httpOnly 쿠키에 담아, 만료 시간을 auth-service의 JWT_REFRESH_EXPIRES_IN 설정과 일치시킵니다.
  // type(USER/ADMIN)에 따라 서로 다른 이름의 쿠키에 저장합니다.
  private setRefreshCookie(
    res: Response,
    type: PrincipalType,
    refreshToken: string,
  ) {
    // env 값은 런타임 string이라 ms.StringValue로 좁혀지지 않으므로 캐스팅합니다.
    // 형식이 잘못되면(오탈자 등) ms()가 NaN을 반환하므로 즉시 실패하도록 검증합니다.
    // 하드코딩된 기본값('7d')은 두지 않습니다 — auth-service가 실제로 서명한 토큰의
    // 만료시간과 값이 달라지면(둘 중 하나만 env 변경 등) 쿠키 만료가 몰래 어긋나기 때문입니다.
    const maxAge = ms(
      getRequiredEnv('JWT_REFRESH_EXPIRES_IN') as ms.StringValue,
    );
    if (Number.isNaN(maxAge)) {
      throw new Error('JWT_REFRESH_EXPIRES_IN 형식이 올바르지 않습니다.');
    }

    res.cookie(REFRESH_COOKIE_NAME[type], refreshToken, {
      ...COOKIE_BASE_OPTIONS,
      maxAge,
    });
  }

  // 액세스 토큰 + 사용자 정보만 응답 바디로 내려줍니다. 프론트엔드는 이 값을 localStorage가 아닌
  // 메모리(변수)에만 보관해야 합니다. 리프레시 토큰은 위 setRefreshCookie로 이미 쿠키에 담겼습니다.
  private toClientResponse(tokens: AuthTokenResponse): AuthClientResponse {
    const { accessToken, userId, email, name, role, socialProvider } = tokens;
    return { accessToken, userId, email, name, role, socialProvider };
  }

  /**
   * POST http://localhost:3000/api/auth/register
   * 브라우저/프론트엔드 HTTP 요청 수신 -> auth-service gRPC 호출 -> user-service에 프로필 생성
   */
  @Post('register')
  @ApiOperation({
    summary: '신규 회원가입',
    description:
      '이메일/비밀번호/이름을 받아 auth-service에 회원가입을 요청합니다. auth-service는 gRPC로 ' +
      'user-service에 프로필을 생성하고, 비밀번호는 해시하여 자체 DB에 저장한 뒤 액세스/리프레시 토큰을 발급합니다. ' +
      '리프레시 토큰은 httpOnly 쿠키로, 액세스 토큰은 응답 바디로 전달됩니다(프론트는 메모리에만 보관).',
  })
  @ApiResponse({
    status: 201,
    description:
      '회원가입 성공 (액세스 토큰은 응답 바디, 리프레시 토큰은 httpOnly 쿠키로 발급)',
  })
  @ApiResponse({
    status: 503,
    description:
      'SIGNUP_FAILED — 가입 도중 실패, 만든 프로필은 되돌림(같은 이메일로 재시도 가능) / ' +
      'SIGNUP_COMPLETED_LOGIN_REQUIRED — 가입은 완료, 토큰 발급만 실패(로그인 화면으로 이동)',
  })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await firstValueFrom(this.authService.register(dto)).catch(
      (err) => {
        // 가입 도중 실패(SIGNUP_FAILED)·가입은 됐는데 토큰 발급만 실패(SIGNUP_COMPLETED_LOGIN_REQUIRED)는
        // 실패 응답 형식 { statusCode, error, code, message, retryable }으로 (LDP-96). 이메일 중복 등은 기존대로 400
        const payload = parseApiRpcError(err);
        if (payload) {
          throw toHttpException(payload);
        }
        throw new BadRequestException(
          err?.details || err?.message || '회원가입에 실패했습니다.',
        );
      },
    );
    this.setRefreshCookie(res, 'USER', tokens.refreshToken);
    return this.toClientResponse(tokens);
  }

  /**
   * POST http://localhost:3000/api/auth/login
   * 브라우저/프론트엔드 HTTP 요청 수신 -> auth-service gRPC 호출 -> 이메일/비밀번호 검증 후 토큰 발급
   */
  @Post('login')
  @ApiOperation({
    summary: '로그인',
    description:
      '이메일/비밀번호를 받아 auth-service에 로그인을 요청합니다. auth-service는 gRPC로 user-service에서 ' +
      '프로필을 조회하고, 자체 DB의 비밀번호 해시와 대조한 뒤 액세스/리프레시 토큰을 발급합니다. ' +
      '리프레시 토큰은 httpOnly 쿠키로, 액세스 토큰은 응답 바디로 전달됩니다(프론트는 메모리에만 보관).',
  })
  @ApiResponse({
    status: 200,
    description:
      '로그인 성공 (액세스 토큰은 응답 바디, 리프레시 토큰은 httpOnly 쿠키로 발급)',
  })
  @ApiResponse({
    status: 401,
    description: '이메일 또는 비밀번호가 일치하지 않음',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 이메일·비밀번호가 틀리면 auth-service가 UNAUTHENTICATED → 401. auth-service·Redis 장애는 503 (LDP-198)
    const tokens = await firstValueFrom(this.authService.login(dto)).catch(
      (err) => {
        throw grpcErrorToHttp(err, {
          code: 'AUTH_SERVICE_UNAVAILABLE',
          message: '로그인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        });
      },
    );
    this.setRefreshCookie(res, 'USER', tokens.refreshToken);
    return this.toClientResponse(tokens);
  }

  /**
   * POST http://localhost:3000/api/auth/admin/login
   * 관리자 전용 로그인. 고객(/api/auth/login)과 완전히 다른 테이블(admins/admin_credentials)을 조회합니다.
   * 요청/응답 형태(email/password → 토큰)는 고객 로그인과 동일하지만, 엔드포인트를 분리해두면 이후
   * 관리자 로그인에만 2FA·IP 제한·로그인 감사로그 같은 정책을 고객 로그인에 영향 없이 추가할 수 있습니다.
   */
  @Post('admin/login')
  @ApiOperation({
    summary: '관리자 로그인',
    description:
      '이메일/비밀번호를 받아 auth-service에 관리자 로그인을 요청합니다. auth-service는 gRPC로 ' +
      'user-service의 AdminService에서 관리자 계정을 조회하고, 자체 DB의 관리자 비밀번호 해시와 대조한 뒤 ' +
      '액세스/리프레시 토큰을 발급합니다(role: "ADMIN"). 리프레시 토큰은 httpOnly 쿠키로, 액세스 토큰은 ' +
      '응답 바디로 전달됩니다.',
  })
  @ApiResponse({
    status: 200,
    description:
      '로그인 성공 (액세스 토큰은 응답 바디, 리프레시 토큰은 httpOnly 쿠키로 발급)',
  })
  @ApiResponse({
    status: 401,
    description: '이메일 또는 비밀번호가 일치하지 않음',
  })
  async adminLogin(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await firstValueFrom(this.authService.adminLogin(dto)).catch(
      (err) => {
        throw new UnauthorizedException(
          err?.details || err?.message || '로그인에 실패했습니다.',
        );
      },
    );
    this.setRefreshCookie(res, 'ADMIN', tokens.refreshToken);
    return this.toClientResponse(tokens);
  }

  // refresh()/adminRefresh()가 공유하는 실제 재발급 로직. type에 따라 어느 쿠키를 읽고 어느 쿠키에
  // 다시 써야 하는지만 다르고, 나머지(gRPC 호출, 응답 형태)는 고객/관리자가 완전히 동일합니다.
  private async doRefresh(type: PrincipalType, req: Request, res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME[type]];
    if (!refreshToken) {
      throw new UnauthorizedException('리프레시 토큰이 없습니다.');
    }

    const tokens = await firstValueFrom(
      this.authService.refresh({ refreshToken }),
    ).catch((err) => {
      throw new UnauthorizedException(
        err?.details || err?.message || '토큰 재발급에 실패했습니다.',
      );
    });
    this.setRefreshCookie(res, type, tokens.refreshToken);
    return this.toClientResponse(tokens);
  }

  /**
   * POST http://localhost:3000/api/auth/refresh
   * 브라우저/프론트엔드 HTTP 요청 수신 -> auth-service gRPC 호출 -> Redis에 저장된 리프레시 토큰과 대조 후 재발급
   * 리프레시 토큰은 요청 바디가 아닌 httpOnly 쿠키(refreshToken, 고객 전용)에서 읽습니다.
   */
  @Post('refresh')
  // 전역 기본(100회/60초)보다 창을 짧게 잡아 회복 시간(Retry-After)을 줄인다. limit도 창 길이에
  // 비례해서 같이 줄여야(100/60s → 20/10s) 초당 허용 처리량이 그대로 유지된다 — limit은 그대로 두고
  // ttl만 줄이면 처리량이 그만큼 늘어나 버려 의도(회복 속도만 개선)와 어긋난다. 새로고침마다 반드시
  // 호출되는 라우트라 F5 연타에 가장 먼저 걸리는데, 다른 라우트는 이 짧은 창의 영향을 받지 않는다.
  @Throttle({ default: { limit: 20, ttl: 10_000 } })
  @ApiOperation({
    summary: '토큰 재발급 (고객)',
    description:
      'httpOnly 쿠키(refreshToken)의 리프레시 토큰으로 auth-service에 재발급을 요청합니다. auth-service는 서명을 검증하고 ' +
      'Redis에 저장된 값과 대조한 뒤 액세스/리프레시 토큰을 새로 발급합니다(로테이션). 로그아웃되었거나 만료된 ' +
      '리프레시 토큰은 거부됩니다.',
  })
  @ApiResponse({
    status: 200,
    description:
      '재발급 성공 (새 액세스 토큰은 응답 바디, 리프레시 토큰은 httpOnly 쿠키로 갱신)',
  })
  @ApiResponse({
    status: 401,
    description: '유효하지 않거나 만료된, 혹은 로그아웃된 리프레시 토큰',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.doRefresh('USER', req, res);
  }

  /**
   * POST http://localhost:3000/api/auth/admin/refresh
   * 관리자 전용 재발급. 고객(/api/auth/refresh)과 별도의 쿠키(adminRefreshToken)만 읽고 씁니다.
   * 두 쿠키는 이름이 달라 브라우저에 동시에 존재할 수 있으므로, 같은 브라우저에서 관리자로 로그인한 뒤
   * 고객 페이지에서 로그인(또는 그 반대)해도 서로의 세션을 덮어쓰지 않습니다.
   */
  @Post('admin/refresh')
  // 고객용 refresh와 동일한 이유로 짧은 창을 둔다 (위 refresh() 주석 참고).
  @Throttle({ default: { limit: 20, ttl: 10_000 } })
  @ApiOperation({
    summary: '토큰 재발급 (관리자)',
    description:
      'httpOnly 쿠키(adminRefreshToken)의 리프레시 토큰으로 auth-service에 재발급을 요청합니다. ' +
      '동작은 고객용 재발급과 동일하나, 읽고 쓰는 쿠키가 분리되어 있습니다.',
  })
  @ApiResponse({
    status: 200,
    description:
      '재발급 성공 (새 액세스 토큰은 응답 바디, 리프레시 토큰은 httpOnly 쿠키로 갱신)',
  })
  @ApiResponse({
    status: 401,
    description: '유효하지 않거나 만료된, 혹은 로그아웃된 리프레시 토큰',
  })
  async adminRefresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.doRefresh('ADMIN', req, res);
  }

  /**
   * POST http://localhost:3000/api/auth/logout
   * 액세스 토큰(Authorization: Bearer, 프론트가 메모리에서 꺼내 실어 보냄)이 유효한 사용자만 호출할 수 있습니다.
   * auth-service가 Redis에 저장된 리프레시 토큰을 삭제해 이후 재발급(Refresh)을 차단합니다.
   * 단, JWT는 무상태이므로 이미 발급된 액세스 토큰 자체는 만료 시간(기본 15분)까지는 계속 유효합니다
   * (프론트는 응답 후 메모리에 든 액세스 토큰을 즉시 버려야 합니다).
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '로그아웃',
    description:
      '유효한 액세스 토큰을 가진 사용자만 호출할 수 있습니다. auth-service가 gRPC로 Redis에 저장된 ' +
      '리프레시 토큰을 삭제하여 재발급을 차단합니다. 서버가 refreshToken 쿠키를 삭제하고, 프론트는 ' +
      '메모리에 든 액세스 토큰을 함께 버려야 합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '로그아웃 성공',
  })
  @ApiResponse({
    status: 401,
    description: '유효하지 않거나 만료된 토큰',
  })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await firstValueFrom(
      this.authService.logout({ userId: user.userId, type: user.type }),
    ).catch((err) => {
      throw new BadRequestException(
        err?.details || err?.message || '로그아웃에 실패했습니다.',
      );
    });
    // 액세스 토큰(Authorization 헤더)으로 이미 principal 타입을 알고 있으므로, 그 타입에 해당하는
    // 쿠키만 지웁니다. 예를 들어 관리자로 로그아웃해도 같은 브라우저의 고객 세션(refreshToken)은 유지됩니다.
    res.clearCookie(REFRESH_COOKIE_NAME[user.type], COOKIE_BASE_OPTIONS);
    return { message: '로그아웃되었습니다.' };
  }

  /**
   * PATCH http://localhost:3000/api/auth/password
   * 액세스 토큰(Authorization: Bearer, 프론트가 메모리에서 꺼내 실어 보냄)이 유효한 사용자 본인의 비밀번호를 변경합니다.
   * auth-service가 현재 비밀번호를 검증한 뒤 새 비밀번호로 해시를 교체하고, Redis의 리프레시 토큰을
   * 삭제해 다른 기기/세션은 재로그인이 필요하도록 만듭니다.
   */
  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '비밀번호 변경',
    description:
      '유효한 액세스 토큰을 가진 사용자 본인의 비밀번호를 변경합니다. 현재 비밀번호가 일치해야 하며, ' +
      '변경 성공 시 다른 기기/세션의 리프레시 토큰은 무효화되어 재로그인이 필요합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '비밀번호 변경 성공',
  })
  @ApiResponse({
    status: 401,
    description: '현재 비밀번호가 일치하지 않음',
  })
  @ApiResponse({
    status: 400,
    description: 'SOCIAL_ACCOUNT_NO_PASSWORD — 카카오로 가입한 계정은 비밀번호가 없음 (LDP-194)',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await firstValueFrom(
      this.authService.changePassword({ userId: user.userId, ...dto }),
    ).catch((err) => {
      // 소셜 회원(SOCIAL_ACCOUNT_NO_PASSWORD)은 { code } 형식 400, 나머지는 기존대로 401
      const payload = parseApiRpcError(err);
      if (payload) {
        throw toHttpException(payload);
      }
      throw new UnauthorizedException(
        err?.details || err?.message || '비밀번호 변경에 실패했습니다.',
      );
    });
    return { message: '비밀번호가 변경되었습니다.' };
  }

  /**
   * GET http://localhost:3000/api/auth/social/kakao/authorize-url?redirectUri=...
   * 카카오 로그인 1단계 (LDP-194). 프론트는 받은 url로 이동하고, 카카오는 로그인 후 redirectUri?code=...&state=...로 돌려보냅니다.
   */
  @Get('social/kakao/authorize-url')
  @ApiOperation({
    summary: '카카오 로그인 — 인가 화면 주소',
    description:
      '카카오 인가 화면 주소를 돌려줍니다. redirectUri는 서버에 등록된 주소(KAKAO_REDIRECT_URIS)만 쓸 수 있습니다. ' +
      'state는 10분 동안 한 번만 쓸 수 있고, 같은 값을 httpOnly 쿠키(socialState)에도 심어 이 브라우저에서 시작한 로그인인지 확인합니다.',
  })
  @ApiResponse({ status: 200, description: '{ url } — 이 주소로 이동' })
  @ApiResponse({
    status: 400,
    description: 'SOCIAL_REDIRECT_URI_INVALID — 등록되지 않은 redirectUri',
  })
  @ApiResponse({
    status: 503,
    description: 'SOCIAL_LOGIN_DISABLED — 카카오 앱 키가 없는 환경 (소셜 로그인 꺼짐)',
  })
  async kakaoAuthorizeUrl(
    @Query('redirectUri') redirectUri: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { url, state } = await firstValueFrom(
      this.authService.socialAuthorizeUrl({
        provider: 'KAKAO',
        redirectUri: redirectUri ?? '',
      }),
    ).catch((err) => {
      throw toSocialHttpError(err, '카카오 로그인을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    });
    res.cookie(SOCIAL_STATE_COOKIE_NAME, state, {
      ...COOKIE_BASE_OPTIONS,
      maxAge: SOCIAL_STATE_MAX_AGE_MS,
    });
    return { url };
  }

  /**
   * POST http://localhost:3000/api/auth/social/kakao
   * 카카오 로그인 2단계. 연결된 회원이면 로그인과 같은 응답, 처음 온 회원이면 { signupRequired: true, signupToken, email, name }
   */
  @Post('social/kakao')
  @ApiOperation({
    summary: '카카오 로그인 — 인가 코드로 로그인',
    description:
      '돌아온 주소의 code·state를 보냅니다. 이미 연결된 회원이면 로그인과 같은 응답(액세스 토큰 + 리프레시 쿠키)에 signupRequired: false. ' +
      '처음 온 회원이면 회원을 만들지 않고 signupRequired: true와 가입 대기 토큰(10분)·카카오 이메일·닉네임을 돌려주며, ' +
      '이름·전화번호를 받아 POST /api/auth/social/signup으로 가입을 마칩니다.',
  })
  @ApiResponse({ status: 200, description: '로그인 완료 또는 추가 정보 입력 필요(signupRequired)' })
  @ApiResponse({
    status: 400,
    description:
      'SOCIAL_STATE_INVALID — state 불일치·만료·재사용 / SOCIAL_EMAIL_REQUIRED — 카카오 이메일 미동의·미인증',
  })
  @ApiResponse({ status: 401, description: 'SOCIAL_LOGIN_FAILED — 인가 코드가 틀렸거나 이미 사용됨' })
  @ApiResponse({
    status: 409,
    description:
      'SOCIAL_EMAIL_IN_USE — 같은 이메일의 이메일 가입 회원 있음 / SOCIAL_ACCOUNT_EXISTS — 다른 카카오 계정으로 가입된 이메일',
  })
  @ApiResponse({
    status: 503,
    description: 'SOCIAL_PROVIDER_UNAVAILABLE — 카카오 연결 실패 / SOCIAL_LOGIN_DISABLED',
  })
  async kakaoLogin(
    @Body() dto: SocialLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieState = req.cookies?.[SOCIAL_STATE_COOKIE_NAME];
    // state 쿠키는 한 번 쓰고 버린다 (성공·실패 모두)
    res.clearCookie(SOCIAL_STATE_COOKIE_NAME, COOKIE_BASE_OPTIONS);
    if (!cookieState || cookieState !== dto.state) {
      throw toHttpException({
        status: 400,
        code: 'SOCIAL_STATE_INVALID',
        message: '로그인 요청이 만료되었습니다. 다시 시도해 주세요.',
        retryable: true,
      });
    }

    const result = await firstValueFrom(
      this.authService.socialLogin({ provider: 'KAKAO', ...dto }),
    ).catch((err) => {
      throw toSocialHttpError(err, '카카오 로그인을 할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    });

    if (result.signupRequired || !result.auth) {
      return {
        signupRequired: true,
        signupToken: result.signupToken,
        email: result.email,
        name: result.name,
      };
    }
    this.setRefreshCookie(res, 'USER', result.auth.refreshToken);
    return { signupRequired: false, ...this.toClientResponse(result.auth) };
  }

  /**
   * POST http://localhost:3000/api/auth/social/signup
   * 카카오 로그인 3단계(처음 온 회원만). 가입 대기 토큰 + 이름·전화번호로 가입을 마치고 로그인 응답을 돌려줍니다.
   */
  @Post('social/signup')
  @ApiOperation({
    summary: '카카오 회원 가입 — 추가 정보 입력',
    description:
      '카카오 로그인 응답의 signupToken과 이름·전화번호로 회원을 만들고 카카오 계정을 연결합니다. 이메일은 카카오 이메일을 씁니다. ' +
      '비밀번호는 만들지 않습니다. 응답은 회원가입과 같습니다(액세스 토큰 + 리프레시 쿠키).',
  })
  @ApiResponse({ status: 201, description: '가입 완료 (socialProvider: "KAKAO")' })
  @ApiResponse({
    status: 400,
    description: 'SOCIAL_SIGNUP_EXPIRED — 가입 대기 토큰 만료(10분)·이미 사용 → 카카오 로그인부터 다시',
  })
  @ApiResponse({
    status: 503,
    description: 'SIGNUP_FAILED / SIGNUP_COMPLETED_LOGIN_REQUIRED — 회원가입과 같음',
  })
  async socialSignup(
    @Body() dto: SocialSignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await firstValueFrom(this.authService.socialSignup(dto)).catch(
      (err) => {
        throw toSocialHttpError(err, '회원가입을 할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      },
    );
    this.setRefreshCookie(res, 'USER', tokens.refreshToken);
    return this.toClientResponse(tokens);
  }
}
