// 계정이 users/admins 중 어느 테이블 소속인지 구분하는 값입니다. role(권한)과는 별개 축입니다 —
// role은 나중에 세분화(예: 고객 등급)될 수 있어도, type은 "어느 도메인/테이블 소속인가"만 나타냅니다.
// auth-service가 Redis 리프레시 토큰 키를 principal 타입별로 네임스페이싱하는 데도 사용합니다.
export type PrincipalType = 'USER' | 'ADMIN';

// auth-service가 발급하고, api-gateway(JwtStrategy)가 검증하는 JWT payload 형태.
// 두 서비스가 동일한 형태를 공유해야 하므로 공통 라이브러리에 둡니다.
export interface JwtPayload {
  sub: number; // userId 또는 adminId (principal id)
  email: string;
  role: string;
  type: PrincipalType;
}

// JwtStrategy.validate()의 반환값이 req.user 로 주입됩니다.
export interface AuthenticatedUser {
  userId: number;
  email: string;
  role: string;
  type: PrincipalType;
}
