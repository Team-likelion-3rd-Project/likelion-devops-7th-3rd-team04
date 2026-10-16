import { authorizedFetch, parseJsonResponse } from './gateway'

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
export interface Booking {
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
  /** 최근 결제 시도 상태 REQUESTED / SUCCEEDED / FAILED. 시도가 없으면 빈 문자열 */
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
export async function createBooking(payload: CreateBookingRequest): Promise<Booking> {
  const res = await authorizedFetch('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<Booking>(res)
}

// GET /api/bookings/me — 로그인한 사용자 본인의 예약 목록을 조회한다 (인증 필요).
// 예약완료 페이지를 새로고침하거나 직접 접근했을 때(전달받은 state가 없을 때) 예약 정보를 다시
// 조회하는 용도로 쓴다 — 단건 조회 API가 따로 없어 목록에서 reservationId로 찾아 쓴다.
export async function fetchMyBookings(): Promise<Booking[]> {
  const res = await authorizedFetch('/api/bookings/me')
  const data = await parseJsonResponse<{ bookings: Booking[] }>(res)
  return data.bookings
}

// GET /api/bookings/{reservationId}/facilities — 해당 예약에 연결된 편의시설(수영장/라운지 등)
// 이용 내역을 조회한다 (인증 필요, 본인 예약이 아니면 403).
export async function fetchReservationFacilities(reservationId: number): Promise<ReservationFacility[]> {
  const res = await authorizedFetch(`/api/bookings/${reservationId}/facilities`)
  const data = await parseJsonResponse<{ facilities: ReservationFacility[] }>(res)
  return data.facilities
}