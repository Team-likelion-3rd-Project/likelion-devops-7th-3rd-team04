import type { Booking } from '../api/gateway'
import { fetchRooms } from '../api/hotels'
import type { Room } from '../api/hotels'
import { HOTELS } from '../data/hotels'
import type { Hotel } from '../data/hotels'
import { formatDate as formatDateObj, parseDateISO } from '../utils/date'

// ReservationHistoryPage(목록)와 ReservationDetailPage(상세)가 함께 쓰는 표시용 헬퍼.
export const STATUS_LABEL: Record<Booking['status'], string> = {
  PENDING_PAYMENT: '결제 대기',
  RESERVED: '예약 확정',
  // 3차 결제 흐름에서 추가된 상태 (메인 DB V3): 결제 5회 실패 / 결제 기한 만료
  PAYMENT_FAILED: '결제 실패',
  EXPIRED: '결제 기한 만료',
  CANCELLED: '취소됨',
  COMPLETED: '이용 완료',
}

// api-gateway가 내려주는 "YYYY-MM-DD" 문자열을 "YYYY.MM.DD" 형태로 표시한다.
export function formatDate(dateString: string): string {
  const date = parseDateISO(dateString)
  return date ? formatDateObj(date) : dateString
}

export interface RoomWithHotel {
  hotel: Hotel
  room: Room
}

// Booking에는 roomId만 있고 hotelId가 없어서, 목록/상세 페이지에서 호텔·객실 정보를 보여주려면
// 어느 호텔 소속인지부터 찾아야 한다. 호텔이 적어(현재 3곳, data/hotels.ts) 전체 호텔의 객실
// 목록을 한 번에 병렬로 불러와 roomId -> {hotel, room} 맵을 만든다. 예약 목록처럼 여러 건을
// 한꺼번에 표시할 때도 호출 한 번(호텔 수만큼 병렬 요청)으로 전부 해결된다.
// TODO: 호텔이 많아지면 백엔드에 roomId만으로 바로 조회하는 API를 추가하는 게 낫다.
export async function fetchRoomLookup(): Promise<Map<number, RoomWithHotel>> {
  const results = await Promise.all(
    HOTELS.map(async (hotel) => {
      const rooms = await fetchRooms(hotel.hotelId)
      return rooms.map((room) => [room.roomId, { hotel, room }] as const)
    }),
  )
  return new Map(results.flat())
}
