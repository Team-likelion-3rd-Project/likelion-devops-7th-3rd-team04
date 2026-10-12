import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from './jwt-payload.interface';

// JwtAuthGuard 통과 후 컨트롤러에서 @CurrentUser() user: AuthenticatedUser 로 사용합니다.
// ⚠️ OptionalJwtAuthGuard 뒤에서는 절대 쓰지 마세요 — req.user가 null일 수 있는데도
// 이 데코레이터는 항상 non-null AuthenticatedUser라고 타입을 속입니다. OptionalJwtAuthGuard와
// 짝을 이루는 라우트는 반드시 아래 OptionalCurrentUser를 쓰세요.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);

// OptionalJwtAuthGuard 통과 후 컨트롤러에서 @OptionalCurrentUser() user: AuthenticatedUser | null
// 로 사용합니다. 토큰이 없거나 유효하지 않으면 null이므로, 반환 타입에 그대로 반영해 호출부가
// 컴파일 타임에 null 체크를 빼먹지 못하게 합니다(CurrentUser처럼 non-null로 속이지 않음).
export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | null => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser | null }>();
    return request.user ?? null;
  },
);
