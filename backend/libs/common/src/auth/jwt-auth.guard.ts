import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// 라우트에 @UseGuards(JwtAuthGuard) 를 붙이면 Authorization 헤더의 JWT를 검증하고
// 통과 시 req.user 에 AuthenticatedUser를 주입합니다.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
