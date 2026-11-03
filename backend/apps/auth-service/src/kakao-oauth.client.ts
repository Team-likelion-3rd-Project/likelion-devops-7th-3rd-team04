import { Injectable, Logger } from '@nestjs/common';
import { apiRpcException, errorTrace } from '@app/common';

// 카카오 로그인 (LDP-194). 프론트가 카카오 인가 화면에서 받은 인가 코드(code)를 여기서 토큰으로 바꾸고,
// 그 토큰으로 카카오 회원 정보(회원번호·이메일·닉네임)를 조회한다.
//   1) 인가 화면 주소  https://kauth.kakao.com/oauth/authorize
//   2) 토큰 교환      POST https://kauth.kakao.com/oauth/token
//   3) 회원 정보      GET  https://kapi.kakao.com/v2/user/me
// 카카오 앱 키(REST API 키)·시크릿은 .env / K8s Secret에만 둔다. KAKAO_CLIENT_ID가 비어 있으면 소셜 로그인은 꺼진다.
const AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const USER_ME_URL = 'https://kapi.kakao.com/v2/user/me';

// 카카오가 늦게 응답해도 로그인 요청이 오래 붙잡히지 않도록 호출마다 시간 제한을 둔다
const KAKAO_TIMEOUT_MS = 5000;

export interface KakaoProfile {
  id: string; // 카카오 회원번호
  email: string | null; // 이메일 제공에 동의하지 않았거나 인증되지 않은 이메일이면 null
  nickname: string | null;
}

interface KakaoUserMeResponse {
  id: number;
  kakao_account?: {
    email?: string;
    is_email_valid?: boolean;
    is_email_verified?: boolean;
    profile?: { nickname?: string };
  };
}

@Injectable()
export class KakaoOAuthClient {
  private readonly logger = new Logger(KakaoOAuthClient.name);

  isEnabled(): boolean {
    return Boolean(process.env.KAKAO_CLIENT_ID);
  }

  // 로그인 후 돌아올 주소는 카카오 개발자 콘솔에 등록한 것만 쓸 수 있다. 여기서도 같은 목록으로 한 번 더 막아,
  // 등록되지 않은 주소로 인가 코드가 새 나가는 요청은 카카오까지 가지 않게 한다.
  isAllowedRedirectUri(redirectUri: string): boolean {
    return (process.env.KAKAO_REDIRECT_URIS ?? '')
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean)
      .includes(redirectUri);
  }

  authorizeUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.KAKAO_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      // 카카오 콘솔 동의 항목(닉네임·이메일 필수)과 같게 명시 — 콘솔 설정이 바뀌어도 이메일 동의를 빠뜨리지 않는다
      scope: 'profile_nickname,account_email',
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  // 인가 코드 → 카카오 회원 정보. 코드가 틀리거나 만료되면 401, 카카오 장애·우리 쪽 설정 오류면 503
  async getProfile(code: string, redirectUri: string): Promise<KakaoProfile> {
    const accessToken = await this.exchangeCode(code, redirectUri);
    const me = await this.request<KakaoUserMeResponse>(USER_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const account = me.kakao_account ?? {};
    // 인증된(is_email_verified) 유효한 이메일만 쓴다. 아니면 다른 사람 이메일로 가입될 수 있다
    const email =
      account.email &&
      account.is_email_verified &&
      account.is_email_valid !== false
        ? account.email
        : null;
    return {
      id: String(me.id),
      email,
      nickname: account.profile?.nickname ?? null,
    };
  }

  private async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.KAKAO_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      code,
    });
    // 카카오 콘솔에서 Client Secret을 켰을 때만 필요하다
    if (process.env.KAKAO_CLIENT_SECRET) {
      body.set('client_secret', process.env.KAKAO_CLIENT_SECRET);
    }
    const token = await this.request<{ access_token: string }>(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body,
    });
    return token.access_token;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`카카오 호출 실패 (${url})`, errorTrace(error));
      throw kakaoUnavailable();
    }
    if (res.ok) {
      return (await res.json()) as T;
    }
    const detail = await res.text().catch(() => '');
    if (res.status >= 500) {
      this.logger.warn(
        `카카오 응답 ${res.status} (${url}) ${detail.slice(0, 200)}`,
      );
      throw kakaoUnavailable();
    }
    // 인가 코드가 틀렸거나 만료·재사용된 경우(invalid_grant)만 사용자 실패 — 카카오 로그인부터 다시 하면 된다
    if (url === TOKEN_URL && isInvalidCode(detail)) {
      this.logger.warn(`카카오 인가 코드 거절 ${detail.slice(0, 200)}`);
      throw apiRpcException({
        status: 401,
        code: 'SOCIAL_LOGIN_FAILED',
        message: '카카오 로그인에 실패했습니다. 다시 시도해 주세요.',
        retryable: true,
      });
    }
    // 그 밖의 4xx는 앱 키·시크릿·Redirect URI 설정 오류처럼 우리 쪽 문제다. 모든 사용자가 실패하므로
    // 사용자 실패(401)로 숨기지 않고 503 + 에러 로그로 알람에 잡히게 한다 (LDP-205)
    this.logger.error(
      `[알람] 카카오 요청 거절 ${res.status} — 앱 키·시크릿·Redirect URI 설정 확인 필요 (${url}) ${detail.slice(0, 200)}`,
    );
    throw kakaoUnavailable();
  }
}

// 카카오 토큰 오류 응답 {"error":"invalid_grant","error_code":"KOE320",...}.
// Redirect URI 불일치(KOE303)도 invalid_grant로 오지만 콘솔 설정 문제라 사용자 실패로 보지 않는다
function isInvalidCode(detail: string): boolean {
  try {
    const body = JSON.parse(detail) as { error?: string; error_code?: string };
    return body.error === 'invalid_grant' && body.error_code !== 'KOE303';
  } catch {
    return false;
  }
}

function kakaoUnavailable() {
  return apiRpcException({
    status: 503,
    code: 'SOCIAL_PROVIDER_UNAVAILABLE',
    message: '카카오에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    retryable: true,
  });
}
