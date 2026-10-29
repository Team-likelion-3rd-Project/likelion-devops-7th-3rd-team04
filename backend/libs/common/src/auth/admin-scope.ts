import { SetMetadata } from '@nestjs/common';
import { toHttpException } from '../grpc/api-error';
import { AdminRole, AuthenticatedUser } from './jwt-payload.interface';

// 관리자 지점·직급 검사 (LDP-178). 토큰의 hotelId·adminRole(LDP-176)로 판단한다.
//   SUPER   본사 — 전 지점
//   MANAGER 지점 관리자 — 자기 지점, 호텔·객실·호실·공지 관리 포함
//   STAFF   직원 — 자기 지점 예약·호실 배정만

export const ADMIN_ROLES_KEY = 'adminRoles';

// 예: @AdminRoles('SUPER', 'MANAGER') — @Roles('ADMIN')·RolesGuard와 함께 사용합니다. 없으면 직급 제한 없음.
export const AdminRoles = (...roles: AdminRole[]) =>
  SetMetadata(ADMIN_ROLES_KEY, roles);

// LDP-176 이전에 발급된 관리자 토큰에는 adminRole이 없다. 그때는 본사 계정만 있었으므로 본사로 본다.
export function adminRoleOf(user: AuthenticatedUser): AdminRole {
  return user.adminRole ?? 'SUPER';
}

// 이 관리자가 다룰 수 있는 지점. null = 전 지점(본사)
export function adminHotelScope(user: AuthenticatedUser): number | null {
  if (adminRoleOf(user) === 'SUPER') {
    return null;
  }
  // 지점 관리자·직원은 지점이 반드시 있다(V13 CHECK). 없으면 어느 지점도 허용하지 않는다.
  if (!user.hotelId) {
    throw adminHotelForbidden();
  }
  return user.hotelId;
}

// 다른 지점 데이터면 403. 본사는 항상 통과
export function assertAdminHotel(
  user: AuthenticatedUser,
  hotelId: number,
): void {
  const scope = adminHotelScope(user);
  if (scope !== null && scope !== hotelId) {
    throw adminHotelForbidden();
  }
}

export function adminHotelForbidden() {
  return toHttpException({
    status: 403,
    code: 'ADMIN_HOTEL_FORBIDDEN',
    message: '다른 지점의 정보는 볼 수 없습니다.',
    retryable: false,
  });
}

export function adminRoleForbidden() {
  return toHttpException({
    status: 403,
    code: 'ADMIN_ROLE_FORBIDDEN',
    message: '이 기능을 사용할 권한이 없습니다.',
    retryable: false,
  });
}
