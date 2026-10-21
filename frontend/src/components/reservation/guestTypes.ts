// GuestSelector.tsx가 컴포넌트만 export하도록(react-refresh 규칙) 타입/상수는 별도 파일로 분리

export interface RoomGuests {
  adults: number
  children: number
  infants: number
}

export const DEFAULT_ROOM_GUESTS: RoomGuests = { adults: 2, children: 0, infants: 0 }

/** 객실별 인원을 모두 합산 — 검색 바/재검색 요약에서 공용으로 쓴다 */
export function sumGuests(rooms: RoomGuests[]): RoomGuests {
  return rooms.reduce(
    (sum, room) => ({
      adults: sum.adults + room.adults,
      children: sum.children + room.children,
      infants: sum.infants + room.infants,
    }),
    { adults: 0, children: 0, infants: 0 },
  )
}
