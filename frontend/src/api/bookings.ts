import { authorizedFetch, parseJsonResponse, type BookingStaffFields } from './gateway'

// gateway CreateBookingDto와 1:1 대응. userId는 서버가 Authorization 헤더의 JWT에서 추출하므로 실어 보내지 않는다.
export interface CreateBookingRequest {
  roomId: number
  hotelId: number
  checkInDate: string
  checkOutDate: string
  guestCount: number
  poolGuestCount?: number
  loungeGuestCount?: number
}

// proto의 Booking 메시지 / gateway BookingDto와 1:1 대응. 편의시설(수영장/라운지) 이용 여부/인원수는
// 여기 담기지 않는다 — fetchReservationFacilities로 별도 조회한다.
export interface Booking extends BookingStaffFields {
  reservationId: number
  userId: number
  roomId: number
  checkInDate: string
  checkOutDate: string
  guestCount: number
  totalAmount: number
  status: string
  /** 결제 마감 시각(ISO 8601). 없으면 빈 문자열 */
  paymentDueAt?: string
  /** 최근 결제 시도 상태 REQUESTED / CONFIRMING / SUCCEEDED / FAILED. 시도가 없으면 빈 문자열.
   * CONFIRMING = 승인 요청 후 결과 확인 중 → 결제 버튼을 막는다 (paymentBlockReason) */
  lastPaymentAttemptStatus?: string
}

// proto의 ReservationFacilityItem 메시지와 1:1 대응되는 응답 형태
export interface ReservationFacility {
  reservationFacilityId: number
  reservationId: number
  facilityId: number
  facilityName: string
  guestCount: number
  totalAmount: number
}

// POST /api/bookings — 로그인한 사용자 본인 명의로 신규 예약을 생성한다 (인증 필요).
// checkInDate~checkOutDate 전날까지 해당 객실이 예약 가능해야 하며, 금액은 서버가 자동 계산한다.
// idempotencyKey: 같은 예약 시도면 같은 키 → 서버가 처음 만든 예약을 돌려준다 (LDP-240, utils/bookingIdempotency.ts)
export async function createBooking(payload: CreateBookingRequest, idempotencyKey?: string): Promise<Booking> {
  const res = await authorizedFetch('/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<Booking>(res)
}

// GET /api/bookings/me/{reservationId} — 본인 예약 한 건 (없으면 null). 예약완료 페이지를 새로고침하거나
// 직접 접근했을 때(전달받은 state가 없을 때) 쓴다. 목록은 gateway.ts의 fetchMyBookingsPage.
export { fetchMyBooking } from './gateway'

// GET /api/bookings/{reservationId}/facilities — 해당 예약에 연결된 편의시설(수영장/라운지 등)
// 이용 내역을 조회한다 (인증 필요, 본인 예약이 아니면 403).
export async function fetchReservationFacilities(reservationId: number): Promise<ReservationFacility[]> {
  const res = await authorizedFetch(`/api/bookings/${reservationId}/facilities`)
  const data = await parseJsonResponse<{ facilities: ReservationFacility[] }>(res)
  return data.facilities
}