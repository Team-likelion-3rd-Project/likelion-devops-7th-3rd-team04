import { fetchAdminHotelRooms } from './adminApi'
import { RoomUnitApiError } from './roomUnits'
import type {
  AssignedReservation,
  RoomUnit,
  RoomUnitInput,
  RoomUnitStatus,
  UnitAssignmentBoard,
} from './roomUnits'

// ─── 호실 API 개발용 가짜 데이터 (VITE_ROOM_UNIT_FAKE=true일 때만 사용) ─────────────────────────
// LDP-89 backend가 나오기 전에 화면을 만들고 확인하려고 둔다. 객실 종류는 실제 API(GET /api/hotels/:id/rooms)에서
// 가져오고, 호실·예약은 브라우저 메모리에 만든다. 명세의 규칙·오류 코드를 흉내 내서 거절 안내도 확인할 수 있다.

interface FakeReservation {
  reservationId: number
  hotelId: number
  roomId: number
  checkInDate: string
  checkOutDate: string
  reservationStatus: string
  userId: number
  guestName: string
  roomUnitId: number | null
}

interface FakeHotel {
  units: RoomUnit[]
  reservations: FakeReservation[]
}

const hotels = new Map<number, Promise<FakeHotel>>()
let nextUnitId = 1
let nextReservationId = 9001

const GUEST_NAMES = ['홍길동', '김철수', '이영희', '박민수', '최지은', '정우성', '한소희', '오세훈']

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300))
}

function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysFromToday(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return toDateString(date)
}

function nextDay(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return toDateString(date)
}

// [checkIn, checkOut) 숙박 기간이 겹치는지 (체크아웃 날은 비어 있다)
function overlaps(a: { checkInDate: string; checkOutDate: string }, b: { checkInDate: string; checkOutDate: string }) {
  return a.checkInDate < b.checkOutDate && b.checkInDate < a.checkOutDate
}

function fail(status: number, code: string, message: string): never {
  throw new RoomUnitApiError(message, status, code)
}

// 지점별로 처음 요청할 때 한 번 만든다: 객실 종류마다 호실 3개(층 = 순서 + 2), 오늘 전후의 예약 몇 건.
async function createFakeHotel(hotelId: number): Promise<FakeHotel> {
  const rooms = await fetchAdminHotelRooms(hotelId).catch(() => [])
  const roomTypes =
    rooms.length > 0
      ? rooms.map((room) => ({ roomId: room.roomId, name: room.name }))
      : [
          { roomId: 1, name: '디럭스 더블룸' },
          { roomId: 2, name: '스탠다드 트윈룸' },
        ]

  const units: RoomUnit[] = []
  const reservations: FakeReservation[] = []
  roomTypes.forEach((roomType, typeIndex) => {
    const floor = typeIndex + 2
    const typeUnits = [1, 2, 3].map((n) => ({
      roomUnitId: nextUnitId++,
      roomId: roomType.roomId,
      roomName: roomType.name,
      hotelId,
      roomNumber: `${floor}0${n}`,
      floor,
      status: (typeIndex === 0 && n === 3 ? 'OUT_OF_SERVICE' : 'ACTIVE') as RoomUnitStatus,
    }))
    units.push(...typeUnits)

    // [체크인 offset, 박 수, 배정할 호실 순서(null = 미배정), 상태]
    const plans: [number, number, number | null, string][] = [
      [0, 2, 0, 'RESERVED'],
      [2, 3, 0, 'RESERVED'],
      [1, 2, 1, 'PENDING_PAYMENT'],
      [1, 3, null, 'RESERVED'],
      [4, 2, null, 'PENDING_PAYMENT'],
    ]
    plans.forEach(([offset, nights, unitIndex, status], i) => {
      reservations.push({
        reservationId: nextReservationId++,
        hotelId,
        roomId: roomType.roomId,
        checkInDate: daysFromToday(offset + typeIndex),
        checkOutDate: daysFromToday(offset + typeIndex + nights),
        reservationStatus: status,
        userId: 100 + reservations.length,
        guestName: GUEST_NAMES[(typeIndex * plans.length + i) % GUEST_NAMES.length],
        roomUnitId: unitIndex === null ? null : typeUnits[unitIndex].roomUnitId,
      })
    })
  })
  return { units, reservations }
}

function getHotel(hotelId: number): Promise<FakeHotel> {
  let hotel = hotels.get(hotelId)
  if (!hotel) {
    hotel = createFakeHotel(hotelId)
    hotels.set(hotelId, hotel)
  }
  return hotel
}

async function findUnit(hotelId: number, roomUnitId: number): Promise<RoomUnit> {
  const hotel = await getHotel(hotelId)
  const unit = hotel.units.find((u) => u.roomUnitId === roomUnitId)
  if (!unit) fail(404, 'ROOM_UNIT_NOT_FOUND', '호실이 없습니다.')
  return unit
}

function checkDuplicatedNumber(hotel: FakeHotel, roomNumber: string, exceptUnitId?: number) {
  if (hotel.units.some((u) => u.roomNumber === roomNumber && u.roomUnitId !== exceptUnitId)) {
    fail(409, 'ROOM_NUMBER_DUPLICATED', '같은 방 번호가 있습니다.')
  }
}

export async function listUnits(hotelId: number, roomId?: number, status?: RoomUnitStatus): Promise<RoomUnit[]> {
  await delay()
  const hotel = await getHotel(hotelId)
  return hotel.units
    .filter((u) => (roomId ? u.roomId === roomId : true) && (status ? u.status === status : true))
    .map((u) => ({ ...u }))
}

export async function createUnit(hotelId: number, roomId: number, input: RoomUnitInput): Promise<RoomUnit> {
  await delay()
  const hotel = await getHotel(hotelId)
  checkDuplicatedNumber(hotel, input.roomNumber)
  const roomName = hotel.units.find((u) => u.roomId === roomId)?.roomName ?? `객실 ${roomId}`
  const unit: RoomUnit = {
    roomUnitId: nextUnitId++,
    roomId,
    roomName,
    hotelId,
    roomNumber: input.roomNumber,
    floor: input.floor ?? null,
    status: 'ACTIVE',
  }
  hotel.units.push(unit)
  return { ...unit }
}

export async function updateUnit(hotelId: number, roomUnitId: number, input: RoomUnitInput): Promise<RoomUnit> {
  await delay()
  const hotel = await getHotel(hotelId)
  const unit = await findUnit(hotelId, roomUnitId)
  checkDuplicatedNumber(hotel, input.roomNumber, roomUnitId)
  unit.roomNumber = input.roomNumber
  unit.floor = input.floor ?? null
  return { ...unit }
}

export async function updateUnitStatus(hotelId: number, roomUnitId: number, status: RoomUnitStatus): Promise<RoomUnit> {
  await delay()
  const hotel = await getHotel(hotelId)
  const unit = await findUnit(hotelId, roomUnitId)

  if (status === 'OUT_OF_SERVICE' && unit.status === 'ACTIVE') {
    const today = daysFromToday(0)
    const active = hotel.reservations.filter((r) => r.roomId === unit.roomId && r.checkOutDate > today)
    if (active.some((r) => r.roomUnitId === roomUnitId)) {
      fail(409, 'ROOM_UNIT_HAS_ASSIGNMENTS', '이 호실에 미래 배정이 있습니다.')
    }
    // 점검하면 보유 수량(ACTIVE 호실 수)이 1 줄어든다 → 어느 날이든 그 객실 종류 예약 수가 넘치면 거절
    const remaining = hotel.units.filter((u) => u.roomId === unit.roomId && u.status === 'ACTIVE').length - 1
    for (let offset = 0; offset < 60; offset++) {
      const day = daysFromToday(offset)
      const booked = active.filter((r) => r.checkInDate <= day && day < r.checkOutDate).length
      if (booked > remaining) fail(409, 'ROOM_UNIT_OVERBOOKING', '점검하면 예약 수가 보유 수량을 넘습니다.')
    }
  }
  unit.status = status
  return { ...unit }
}

export async function assignUnit(reservationId: number, roomUnitId: number | null): Promise<AssignedReservation> {
  await delay()
  const allHotels = await Promise.all(hotels.values())
  const hotel = allHotels.find((h) => h.reservations.some((r) => r.reservationId === reservationId))
  const reservation = hotel?.reservations.find((r) => r.reservationId === reservationId)
  if (!hotel || !reservation) fail(404, 'RESERVATION_NOT_FOUND', '예약이 없습니다.')
  if (!['PENDING_PAYMENT', 'RESERVED'].includes(reservation.reservationStatus)) {
    fail(409, 'INVALID_RESERVATION_STATUS', '배정할 수 없는 예약 상태입니다.')
  }

  if (roomUnitId !== null) {
    const unit = hotel.units.find((u) => u.roomUnitId === roomUnitId)
    if (!unit) fail(404, 'ROOM_UNIT_NOT_FOUND', '호실이 없습니다.')
    if (unit.roomId !== reservation.roomId || unit.status !== 'ACTIVE') {
      fail(409, 'ROOM_UNIT_NOT_ASSIGNABLE', '배정할 수 없는 호실입니다.')
    }
    const conflict = hotel.reservations.some(
      (r) => r.reservationId !== reservationId && r.roomUnitId === roomUnitId && overlaps(r, reservation),
    )
    if (conflict) fail(409, 'ROOM_UNIT_ASSIGNMENT_CONFLICT', '겹치는 기간에 다른 배정이 있습니다.')
  }

  reservation.roomUnitId = roomUnitId
  const roomNumber = hotel.units.find((u) => u.roomUnitId === roomUnitId)?.roomNumber ?? ''
  return { reservationId, roomUnitId, roomNumber, status: reservation.reservationStatus }
}

export async function assignmentBoard(
  hotelId: number,
  startDate: string,
  endDate: string,
  roomId?: number,
): Promise<UnitAssignmentBoard> {
  await delay()
  const hotel = await getHotel(hotelId)
  // endDate는 그날 밤까지 포함 → 숙박 기간 [checkIn, checkOut)과 [startDate, endDate 다음 날) 비교
  const range = { checkInDate: startDate, checkOutDate: nextDay(endDate) }
  const inRange = hotel.reservations.filter((r) => (roomId ? r.roomId === roomId : true) && overlaps(r, range))
  const toAssignment = (r: FakeReservation) => ({
    reservationId: r.reservationId,
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    reservationStatus: r.reservationStatus,
    userId: r.userId,
    guestName: r.guestName,
  })

  return {
    hotelId,
    startDate,
    endDate,
    units: hotel.units
      .filter((u) => (roomId ? u.roomId === roomId : true))
      .map((unit) => ({
        roomUnitId: unit.roomUnitId,
        roomId: unit.roomId,
        roomName: unit.roomName,
        roomNumber: unit.roomNumber,
        floor: unit.floor,
        status: unit.status,
        assignments: inRange.filter((r) => r.roomUnitId === unit.roomUnitId).map(toAssignment),
      })),
    unassigned: inRange.filter((r) => r.roomUnitId === null).map((r) => ({ ...toAssignment(r), roomId: r.roomId })),
  }
}
