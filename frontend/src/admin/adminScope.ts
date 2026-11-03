import { adminAuth } from '../api/tokenStore'

// 관리자 지점·직급 (LDP-184). 로그인 토큰(JWT)에 담긴 hotelId·adminRole(LDP-176)을 읽어
// 메뉴·라우트·지점 선택을 나눈다. 화면은 UX용이고, 실제 차단은 서버(api-gateway RolesGuard, LDP-178)가 한다.
//   SUPER   본사 — 전 지점, 회원 관리 포함
//   MANAGER 지점 관리자 — 자기 지점, 호텔·객실·공지 관리 포함
//   STAFF   직원 — 자기 지점 예약·호실 배정만

export type AdminRole = 'SUPER' | 'MANAGER' | 'STAFF'

export interface AdminScope {
  role: AdminRole
  /** 소속 지점. null = 전 지점(본사) */
  hotelId: number | null
}

export const ADMIN_ROLE_LABEL: Record<AdminRole, string> = {
  SUPER: '본사 관리자',
  MANAGER: '지점 관리자',
  STAFF: '직원',
}

// 메뉴·라우트별 허용 직급. 서버 @AdminRoles와 같게 맞춘다 (없는 메뉴는 전원 허용).
export const ADMIN_AREA_ROLES = {
  users: ['SUPER'],
  hotels: ['SUPER', 'MANAGER'],
  notices: ['SUPER', 'MANAGER'],
} satisfies Record<string, AdminRole[]>

export type AdminArea = keyof typeof ADMIN_AREA_ROLES

const ROLES: AdminRole[] = ['SUPER', 'MANAGER', 'STAFF']

// 서명 검증 없이 payload만 읽는다 — 서버가 매 요청 검증하므로 화면 분기용으로 충분하다.
function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      Array.from(atob(base64), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

// LDP-176 이전에 발급된 토큰에는 adminRole이 없다. 그때는 본사 계정만 있었으므로 본사로 본다 (서버 adminRoleOf와 같음).
export function adminScopeOf(token: string | null): AdminScope {
  const payload = token ? decodePayload(token) : null
  const role = ROLES.includes(payload?.adminRole as AdminRole) ? (payload?.adminRole as AdminRole) : 'SUPER'
  const hotelId = typeof payload?.hotelId === 'number' && payload.hotelId > 0 ? payload.hotelId : null
  return { role, hotelId: role === 'SUPER' ? null : hotelId }
}

export function useAdminScope(): AdminScope {
  return adminScopeOf(adminAuth.useAccessToken())
}

export function canAccessArea(scope: AdminScope, area: AdminArea): boolean {
  return (ADMIN_AREA_ROLES[area] as AdminRole[]).includes(scope.role)
}

// 다른 지점 데이터인지. 본사는 항상 허용
export function canAccessHotel(scope: AdminScope, hotelId: number): boolean {
  return scope.hotelId === null || scope.hotelId === hotelId
}

// 지점 계정에는 자기 지점만 보이게 한다 (호텔 목록 공용 필터)
export function filterHotelsInScope<T extends { hotelId: number }>(scope: AdminScope, hotels: T[]): T[] {
  return scope.hotelId === null ? hotels : hotels.filter((h) => h.hotelId === scope.hotelId)
}

// 서버 403 code별 안내 (LDP-178 admin-scope.ts). 그 밖의 오류는 서버 메시지를 그대로 쓴다.
const FORBIDDEN_MESSAGE: Record<string, string> = {
  ADMIN_HOTEL_FORBIDDEN: '다른 지점의 정보는 볼 수 없습니다. 소속 지점의 데이터만 관리할 수 있습니다.',
  ADMIN_ROLE_FORBIDDEN: '이 기능을 사용할 권한이 없습니다. 필요하면 지점 관리자 또는 본사에 요청해 주세요.',
}

export function adminErrorMessage(code: string | undefined, fallback: string): string {
  return (code && FORBIDDEN_MESSAGE[code]) || fallback
}
