import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from './jwt-payload.interface';

// 라우트에 @UseGuards(OptionalJwtAuthGuard) 를 붙이면 Authorization 헤더의 JWT를 검증하되,
// 토큰이 없거나 유효하지 않아도 401을 던지지 않고 req.user 를 null로 둔 채 통과시킵니다.
// 로그인/비로그인 사용자를 모두 받아야 하는 라우트(예: 챗봇 메시지 전송)에서 사용합니다.
//
// 보안 노트:
// - 서명이 잘못됐거나 만료된 토큰도 여기서 똑같이 null(비로그인)로 처리됩니다. passport-jwt는
//   서명/만료 검증을 통과한 토큰에 대해서만 handleRequest에 user를 채워 넘기므로(검증 실패 시
//   user===false), 위조/만료 토큰이 인증된 사용자로 둔갑할 방법은 없습니다 — "검증 실패 시
//   비로그인으로 안전하게 떨어지는" 방향이라 의도된 동작입니다.
// - 컨트롤러에서는 반드시 @CurrentUser()가 아니라 @OptionalCurrentUser()
//   (current-user.decorator.ts)를 써서 user가 null일 수 있음을 타입으로 강제하세요.
// - RolesGuard와 절대 함께 쓰지 마세요. 로그인 여부와 무관하게 열려있어야 하는 라우트와
//   특정 role만 허용해야 하는 라우트는 애초에 다른 라우트여야 합니다(RolesGuard 쪽 주석 참고).
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    _err: unknown,
    user: TUser | false,
  ): TUser | null {
    return user || null;
  }
}
