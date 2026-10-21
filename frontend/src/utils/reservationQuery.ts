// 예약 플로우 단계 사이(호텔/날짜/투숙인원 선택 <-> 객실 선택)를 이동할 때 URL 쿼리스트링으로
// 검색 조건을 주고받기 위한 인코딩/디코딩 유틸. 쿼리스트링에 담아두면 새로고침해도 조건이 유지되고,
// "재검색" 등으로 이전 단계로 돌아갈 때도 그대로 복원할 수 있다.

import type { RoomGuests } from '../components/reservation/guestTypes'
import { formatDateISO, parseDateISO } from './date'

export interface ReservationSearch {
  /** data/hotels.ts의 문자열 id (hotel-service의 숫자 PK가 아님) */
  hotelSlug: string
  checkIn: Date
  checkOut: Date
  rooms: RoomGuests[]
}

export function toReservationSearchParams(search: ReservationSearch): URLSearchParams {
  const params = new URLSearchParams()
  params.set('hotel', search.hotelSlug)
  params.set('checkIn', formatDateISO(search.checkIn))
  params.set('checkOut', formatDateISO(search.checkOut))
  params.set('rooms', JSON.stringify(search.rooms))
  return params
}

/** 쿼리스트링이 없거나 형식이 잘못됐으면 null — 호출부에서 /reservation으로 돌려보내는 등 처리한다 */
export function parseReservationSearchParams(params: URLSearchParams): ReservationSearch | null {
  const hotelSlug = params.get('hotel')
  const checkInRaw = params.get('checkIn')
  const checkOutRaw = params.get('checkOut')
  const roomsRaw = params.get('rooms')
  if (!hotelSlug || !checkInRaw || !checkOutRaw || !roomsRaw) return null

  const checkIn = parseDateISO(checkInRaw)
  const checkOut = parseDateISO(checkOutRaw)
  if (!checkIn || !checkOut || checkOut.getTime() <= checkIn.getTime()) return null

  let rooms: RoomGuests[]
  try {
    const parsed = JSON.parse(roomsRaw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    rooms = parsed
  } catch {
    return null
  }

  return { hotelSlug, checkIn, checkOut, rooms }
}
