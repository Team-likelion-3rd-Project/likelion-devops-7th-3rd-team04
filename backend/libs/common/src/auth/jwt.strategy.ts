import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser, JwtPayload } from './jwt-payload.interface';
import { getRequiredEnv } from '../utils/env.util';

// 액세스 토큰은 httpOnly 쿠키가 아니라 프론트엔드가 메모리(변수)에 들고 있다가
// Authorization: Bearer <accessToken> 헤더에 실어 보냅니다 (리프레시 토큰만 httpOnly 쿠키).
// auth-service가 서명할 때 쓰는 것과 동일한 JWT_ACCESS_SECRET을 사용해야 합니다.
// 값이 없으면 하드코딩된 기본값으로 조용히 넘어가지 않고 즉시 에러를 던져 부팅을 막습니다
// (기본값을 아는 사람이라면 누구나 토큰을 위조할 수 있으므로).
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getRequiredEnv('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload?.sub) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      type: payload.type,
      hotelId: payload.hotelId,
      adminRole: payload.adminRole,
    };
  }
}
