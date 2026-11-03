import { authedFetch, authedJsonFetch } from './adminApi'
import { adminErrorMessage } from '../admin/adminScope'
import { ApiError, type Booking } from './gateway'
import type { Payment } from './payments'

// ─── 관리자 예약 관리 — 예약 목록, 대리 예약·직원 취소·투숙 연장 (LDP-90 #172, PR #204) ─────────────
// 대리 예약·연장 예약은 손님 앱의 "결제 대기"에 나타나고, 손님이 결제해야 확정된다.
// 결제 마감은 서버가 정한다 — 직원이 만든 예약은 만든 날 밤 자정(한국 시간), 최소 30분 (LDP-92).

// 관리자 전체 예약 목록의 예약 한 건 (손님 예약 응답 + 지점 + 예약자 — LDP-150 #301)
export interface AdminBooking extends Booking {
  hotelId: number
  /** 예약자 이름·이메일 (목록 응답에만 있음, 탈퇴 회원이면 빈 문자열) */
  guestName?: string
  guestEmail?: string
}

// GET /api/bookings 조건 (LDP-136 #287) — 생략한 칸은 조건 없음
export interface AdminBookingQuery {
  page?: number
  size?: number
  hotelId?: number
  /** 예약 상태 여러 개 (쉼표로 보낸다) */
  status?: string[]
  /** 예약번호·회원 이름·이메일·연락처·호실 일부 */
  keyword?: string
  /** 이 예약과 그 연장 예약만 */
  linkedTo?: number
}

// POST /api/bookings/admin 요청 — 손님 예약(5.2) 항목 + 예약할 회원
export interface AdminCreateBookingRequest {
  userId: number
  hotelId: number
  roomId: number
  checkInDate: string
  checkOutDate: string
  guestCount: number
  poolGuestCount?: number
  loungeGuestCount?: number
}

// 오류 코드별 안내 (#172 에러 코드 + 좌형님 정리). 서버 message보다 먼저 보여준다 — 직원이 다음에 할 일을 알 수 있게.
const ADMIN_RESERVATION_ERROR_MESSAGE: Record<string, string> = {
  USER_NOT_FOUND: '회원을 찾을 수 없습니다. 회원 목록을 새로고침해 주세요.',
  RESERVATION_NOT_FOUND: '예약을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
  INVALID_RESERVATION_STATUS:
    '이 예약은 처리할 수 없는 상태입니다. 이미 취소·만료·완료된 예약은 취소할 수 없고, 연장은 예약 확정된 예약만 가능합니다.',
  ROOM_NOT_AVAILABLE: '선택한 기간에 매진이거나 판매 중지된 날짜가 있습니다. 날짜나 객실 종류를 바꿔 주세요.',
  FACILITY_NOT_AVAILABLE: '이 지점에 없는 편의시설입니다. 수영장·라운지 인원을 0으로 바꿔 주세요.',
  INVALID_EXTENSION_DATES: '연장 체크아웃은 지금 체크아웃보다 뒤 날짜여야 합니다.',
  INVALID_BOOKING_DATES: '체크아웃은 체크인보다 뒤 날짜여야 합니다.',
  INVALID_CANCEL_REASON: '취소 사유를 1~255자로 입력해 주세요.',
  USER_SERVICE_UNAVAILABLE: '회원 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  BOOKING_SERVICE_UNAVAILABLE: '예약 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
  HOTEL_SERVICE_UNAVAILABLE: '지점·객실 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
}

export function adminReservationErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code && ADMIN_RESERVATION_ERROR_MESSAGE[err.code]) {
    return ADMIN_RESERVATION_ERROR_MESSAGE[err.code]
  }
  return err instanceof Error && err.message ? err.message : fallback
}

// 실패 응답 { statusCode, error, code, message, retryable } (명세 5.10) — code를 담아 던진다
async function parseAdminResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // ValidationPipe(class-validator) 에러는 message가 문자열 배열로 내려온다.
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new ApiError(adminErrorMessage(body?.code, message ?? `${res.status} ${res.statusText}`), res.status, body?.code)
  }
  return body as T
}

// GET /api/bookings (관리자 전용) - 조건에 맞는 예약 (최신순). page를 주면 그 페이지만, total은 조건에 맞는 전체 개수.
export async function fetchAdminBookings(
  query: AdminBookingQuery = {},
): Promise<{ bookings: AdminBooking[]; total: number }> {
  const params = new URLSearchParams()
  if (query.page) params.set('page', String(query.page))
  if (query.size) params.set('size', String(query.size))
  if (query.hotelId) params.set('hotelId', String(query.hotelId))
  if (query.status?.length) params.set('status', query.status.join(','))
  if (query.keyword?.trim()) params.set('keyword', query.keyword.trim())
  if (query.linkedTo) params.set('linkedTo', String(query.linkedTo))
  const qs = params.toString()
  const res = await authedFetch(`/api/bookings${qs ? `?${qs}` : ''}`)
  const data = await parseAdminResponse<{ bookings?: AdminBooking[]; total?: number }>(res)
  return { bookings: data.bookings ?? [], total: data.total ?? 0 }
}

// 연장 묶음 — 원래 예약과 그 연장 예약 전부. 연장 예약이 목록의 다른 페이지에 있을 수 있어 따로 조회한다.
export async function fetchLinkedBookings(rootReservationId: number): Promise<AdminBooking[]> {
  return (await fetchAdminBookings({ linkedTo: rootReservationId })).bookings
}

// GET /api/payments/users/{userId} (관리자 전용) - 회원의 결제 목록 (결제 상태·금액·환불 시각)
export async function fetchAdminUserPayments(userId: number): Promise<Payment[]> {
  const res = await authedFetch(`/api/payments/users/${userId}`)
  const data = await parseAdminResponse<{ payments?: Payment[] }>(res)
  return data.payments ?? []
}

// 예약별 가장 최근 결제(결제 번호가 큰 것) — 한 예약에 결제 시도가 여러 번이면 마지막 것이 지금 상태다
export function latestPaymentByReservation(payments: Payment[]): Map<number, Payment> {
  const map = new Map<number, Payment>()
  for (const p of payments) {
    const prev = map.get(p.reservationId)
    if (!prev || p.paymentId > prev.paymentId) map.set(p.reservationId, p)
  }
  return map
}

// POST /api/bookings/admin (관리자 전용) - 대리 예약 생성 (만든 직원이 기록됨)
export async function createAdminBooking(input: AdminCreateBookingRequest): Promise<AdminBooking> {
  const res = await authedJsonFetch('/api/bookings/admin', 'POST', input)
  return parseAdminResponse<AdminBooking>(res)
}

// POST /api/bookings/{id}/admin-cancel (관리자 전용) - 직원 취소. 결제됐으면 전액 환불, 연결된 연장 예약도 함께 취소된다.
export async function adminCancelBooking(reservationId: number, cancelReason: string): Promise<AdminBooking> {
  const res = await authedJsonFetch(`/api/bookings/${reservationId}/admin-cancel`, 'POST', { cancelReason })
  return parseAdminResponse<AdminBooking>(res)
}

// POST /api/bookings/{id}/extensions (관리자 전용) - 투숙 연장 예약 생성 (예약 확정된 예약만).
// 체크인 = 지금 체크아웃. keepSameRoomUnit이면 같은 호실이 비어 있을 때 같은 호실로 배정되고, 아니면 미배정(roomUnitId null).
// 연장의 연장은 가장 최근 연장 예약 번호로 요청한다.
export async function createExtensionBooking(
  reservationId: number,
  checkOutDate: string,
  keepSameRoomUnit: boolean,
): Promise<AdminBooking> {
  const res = await authedJsonFetch(`/api/bookings/${reservationId}/extensions`, 'POST', {
    checkOutDate,
    keepSameRoomUnit,
  })
  return parseAdminResponse<AdminBooking>(res)
}
