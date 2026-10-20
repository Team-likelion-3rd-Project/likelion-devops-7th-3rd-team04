import { authedFetch, authedJsonFetch } from './adminApi'
import { ApiError } from './gateway'
import * as fake from './roomUnitsFake'

// ─── 호실(방 번호) 관리·예약 호실 배정 — 관리자 전용 ──────────────────────────────────────────
// 요청·응답 형식은 LDP-89(#171) 본문의 확정 명세 기준이다. API의 roomId는 지금처럼 "객실 종류" ID이고,
// 실제 방(101호·102호…)은 roomUnitId로 구분한다. 호실 삭제는 없고 점검(OUT_OF_SERVICE)으로 대신한다.

// backend 호실 API가 준비되기 전 화면 확인용 가짜 데이터. true면 서버를 호출하지 않고 브라우저 메모리에서
// 응답한다 (.env의 VITE_ROOM_UNIT_FAKE). 새로고침하면 처음 상태로 돌아간다. 실제 API 연결 후에는 비워 둔다.
export const IS_ROOM_UNIT_FAKE = import.meta.env.VITE_ROOM_UNIT_FAKE === 'true'

export type RoomUnitStatus = 'ACTIVE' | 'OUT_OF_SERVICE'

// 호실 응답 (명세 "호실 응답 형식")
export interface RoomUnit {
  roomUnitId: number
  roomId: number // 객실 종류 ID
  roomName: string
  hotelId: number
  roomNumber: string
  floor: number | null
  status: RoomUnitStatus
}

export interface RoomUnitInput {
  roomNumber: string
  floor?: number
}

// 배정 현황에 나오는 예약 (결제 대기·예약 확정만)
export interface UnitAssignment {
  reservationId: number
  checkInDate: string
  checkOutDate: string
  reservationStatus: string
  userId: number
  guestName: string
}

export interface UnassignedReservation extends UnitAssignment {
  roomId: number
}

export interface RoomUnitAssignments extends Omit<RoomUnit, 'hotelId'> {
  assignments: UnitAssignment[]
}

// GET /api/hotels/{hotelId}/unit-assignments 응답
export interface UnitAssignmentBoard {
  hotelId: number
  startDate: string
  endDate: string
  units: RoomUnitAssignments[]
  unassigned: UnassignedReservation[] // 기간 안의 아직 배정 안 된 예약 → 직원이 배정할 목록
}

// PUT /api/bookings/{reservationId}/room-unit 응답(예약 응답) 중 화면에서 쓰는 값
export interface AssignedReservation {
  reservationId: number
  roomUnitId: number | null
  roomNumber: string
  status: string
}

// 실패 응답 { statusCode, error, code, message, retryable } — 결제 API(명세 5.10)와 같은 형식
export class RoomUnitApiError extends ApiError {
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message, status)
    this.name = 'RoomUnitApiError'
    this.code = code
  }
}

// 오류 코드별 안내 문구 (명세 "에러 코드"). 서버 message보다 이 문구를 먼저 보여준다 — 직원이 다음에 할 일을 알 수 있게.
const ROOM_UNIT_ERROR_MESSAGE: Record<string, string> = {
  ROOM_UNIT_NOT_FOUND: '호실을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
  RESERVATION_NOT_FOUND: '예약을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
  ROOM_NUMBER_DUPLICATED: '이 지점에 같은 방 번호가 이미 있습니다.',
  ROOM_UNIT_OVERBOOKING: '이 호실을 점검하면 이미 받은 예약 수가 보유 수량을 넘습니다. 예약이 적은 날로 미루거나 다른 호실을 점검해 주세요.',
  ROOM_UNIT_HAS_ASSIGNMENTS: '이 호실에 앞으로 배정된 예약이 있습니다. 먼저 다른 호실로 옮긴 뒤 점검해 주세요.',
  ROOM_UNIT_NOT_ASSIGNABLE: '배정할 수 없는 호실입니다. 같은 객실 종류의 사용 가능한 호실을 골라 주세요.',
  ROOM_UNIT_ASSIGNMENT_CONFLICT: '이 호실은 겹치는 기간에 다른 예약이 배정되어 있습니다.',
  INVALID_RESERVATION_STATUS: '취소·만료·결제 실패된 예약은 호실을 배정할 수 없습니다.',
}

export function roomUnitErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof RoomUnitApiError && err.code && ROOM_UNIT_ERROR_MESSAGE[err.code]) {
    return ROOM_UNIT_ERROR_MESSAGE[err.code]
  }
  return err instanceof Error && err.message ? err.message : fallback
}

async function parseRoomUnitResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // ValidationPipe(class-validator) 에러는 message가 문자열 배열로 내려온다.
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new RoomUnitApiError(message ?? `${res.status} ${res.statusText}`, res.status, body?.code)
  }
  return body as T
}

// 1. GET /api/hotels/{hotelId}/rooms/{roomId}/units - 객실 종류별 호실 목록
export async function fetchRoomUnits(hotelId: number | string, roomId: number | string): Promise<RoomUnit[]> {
  if (IS_ROOM_UNIT_FAKE) return fake.listUnits(Number(hotelId), Number(roomId))
  const res = await authedFetch(`/api/hotels/${hotelId}/rooms/${roomId}/units`)
  const data = await parseRoomUnitResponse<{ units?: RoomUnit[] }>(res)
  return data.units ?? []
}

// 2. GET /api/hotels/{hotelId}/units?status=&roomId= - 지점 전체 호실 목록 (쿼리 모두 선택)
export async function fetchHotelRoomUnits(
  hotelId: number | string,
  filter: { status?: RoomUnitStatus; roomId?: number } = {},
): Promise<RoomUnit[]> {
  if (IS_ROOM_UNIT_FAKE) return fake.listUnits(Number(hotelId), filter.roomId, filter.status)
  const query = new URLSearchParams()
  if (filter.status) query.set('status', filter.status)
  if (filter.roomId) query.set('roomId', String(filter.roomId))
  const res = await authedFetch(`/api/hotels/${hotelId}/units${query.size > 0 ? `?${query}` : ''}`)
  const data = await parseRoomUnitResponse<{ units?: RoomUnit[] }>(res)
  return data.units ?? []
}

// 3. POST /api/hotels/{hotelId}/rooms/{roomId}/units - 호실 추가 (ACTIVE로 생성, 보유 수량 +1)
export async function createRoomUnit(
  hotelId: number | string,
  roomId: number | string,
  input: RoomUnitInput,
): Promise<RoomUnit> {
  if (IS_ROOM_UNIT_FAKE) return fake.createUnit(Number(hotelId), Number(roomId), input)
  const res = await authedJsonFetch(`/api/hotels/${hotelId}/rooms/${roomId}/units`, 'POST', input)
  return parseRoomUnitResponse<RoomUnit>(res)
}

// 4. PUT /api/hotels/{hotelId}/units/{roomUnitId} - 호실 수정 (방 번호·층)
export async function updateRoomUnit(
  hotelId: number | string,
  roomUnitId: number,
  input: RoomUnitInput,
): Promise<RoomUnit> {
  if (IS_ROOM_UNIT_FAKE) return fake.updateUnit(Number(hotelId), roomUnitId, input)
  const res = await authedJsonFetch(`/api/hotels/${hotelId}/units/${roomUnitId}`, 'PUT', input)
  return parseRoomUnitResponse<RoomUnit>(res)
}

// 5. PUT /api/hotels/{hotelId}/units/{roomUnitId}/status - 점검 처리(OUT_OF_SERVICE, 보유 수량 -1)·해제(ACTIVE, +1)
export async function updateRoomUnitStatus(
  hotelId: number | string,
  roomUnitId: number,
  status: RoomUnitStatus,
): Promise<RoomUnit> {
  if (IS_ROOM_UNIT_FAKE) return fake.updateUnitStatus(Number(hotelId), roomUnitId, status)
  const res = await authedJsonFetch(`/api/hotels/${hotelId}/units/${roomUnitId}/status`, 'PUT', { status })
  return parseRoomUnitResponse<RoomUnit>(res)
}

// 6. PUT /api/bookings/{reservationId}/room-unit - 예약 호실 배정·변경, roomUnitId가 null이면 배정 해제
export async function assignReservationRoomUnit(
  reservationId: number,
  roomUnitId: number | null,
): Promise<AssignedReservation> {
  if (IS_ROOM_UNIT_FAKE) return fake.assignUnit(reservationId, roomUnitId)
  const res = await authedJsonFetch(`/api/bookings/${reservationId}/room-unit`, 'PUT', { roomUnitId })
  return parseRoomUnitResponse<AssignedReservation>(res)
}

// 7. GET /api/hotels/{hotelId}/unit-assignments?startDate=&endDate=&roomId= - 기간별 호실 배정 현황 (기간 최대 31일)
export async function fetchUnitAssignmentBoard(
  hotelId: number | string,
  startDate: string,
  endDate: string,
  roomId?: number,
): Promise<UnitAssignmentBoard> {
  if (IS_ROOM_UNIT_FAKE) return fake.assignmentBoard(Number(hotelId), startDate, endDate, roomId)
  const query = new URLSearchParams({ startDate, endDate })
  if (roomId) query.set('roomId', String(roomId))
  const res = await authedFetch(`/api/hotels/${hotelId}/unit-assignments?${query}`)
  const data = await parseRoomUnitResponse<UnitAssignmentBoard>(res)
  return { ...data, units: data.units ?? [], unassigned: data.unassigned ?? [] }
}
