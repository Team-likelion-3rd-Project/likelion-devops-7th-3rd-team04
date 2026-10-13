// 비워 두면 같은 출처의 /api/...로 호출한다 — 컨테이너에서는 Nginx가 /api를 api-gateway로 프록시한다.
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

// proto의 RoomImage 메시지 / gateway RoomDto.images와 1:1 대응
export interface RoomImage {
  imageId: number
  mimeType: string
  imageBase64: string
  sortOrder: number
}

// proto의 Room 메시지 / gateway RoomDto와 1:1 대응
export interface Room {
  roomId: number
  hotelId: number
  name: string
  capacity: number
  description: string
  images: RoomImage[]
}

interface RoomListResponse {
  rooms: Room[]
}

// proto의 RoomSearchResult 메시지 / gateway RoomSearchResultDto와 1:1 대응
export interface RoomSearchResult {
  room: Room
  /** 검색 구간(checkIn~checkOut 전날) 중 가장 저렴한 1박 요금 */
  minPrice: number
}

interface RoomSearchResponse {
  results: RoomSearchResult[]
}

// DB에는 Base64 원문만 저장되어 있어, <img src>에 바로 쓸 수 있는 data URL로 변환한다.
export function toImageDataUrl(image: RoomImage): string {
  return `data:${image.mimeType};base64,${image.imageBase64}`
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json()
}

// GET /api/hotels/{hotelId}/rooms — 특정 호텔의 전체 객실 목록 조회 (인증 불필요)
export async function fetchRooms(hotelId: number): Promise<Room[]> {
  const res = await fetch(`${BASE_URL}/api/hotels/${hotelId}/rooms`)
  const data = await parseJsonOrThrow<RoomListResponse>(res)
  return data.rooms
}

// GET /api/hotels/{hotelId}/rooms/search — 체크인/체크아웃/인원수 조건으로 예약 가능한 객실 검색 (인증 불필요)
// checkOut 당일은 밤을 묵지 않으므로 검사 대상에서 제외된다(hotel-service 쪽 규칙과 동일). 응답에는
// 객실별 minPrice(구간 중 최저 1박 요금)가 이미 포함돼 있어, 이후 fetchRoomAvailability를 다시 호출할 필요가 없다.
export async function searchRooms(
  hotelId: number,
  checkIn: string,
  checkOut: string,
  guests: number,
): Promise<RoomSearchResult[]> {
  const params = new URLSearchParams({ checkIn, checkOut, guests: String(guests) })
  const res = await fetch(`${BASE_URL}/api/hotels/${hotelId}/rooms/search?${params}`)
  const data = await parseJsonOrThrow<RoomSearchResponse>(res)
  return data.results
}

// GET /api/hotels/{hotelId}/rooms/{roomId} — 단건 객실 상세 조회 (인증 불필요)
export async function fetchRoom(hotelId: number, roomId: number): Promise<Room> {
  const res = await fetch(`${BASE_URL}/api/hotels/${hotelId}/rooms/${roomId}`)
  return parseJsonOrThrow<Room>(res)
}

// proto의 RoomAvailabilityDay 메시지 / gateway RoomAvailabilityDayDto와 1:1 대응
export interface RoomAvailabilityDay {
  date: string
  isAvailable: boolean
  price: number
}

// proto의 RoomAvailabilityResponse 메시지 / gateway RoomAvailabilityDto와 1:1 대응
export interface RoomAvailability {
  hotelId: number
  roomId: number
  startDate: string
  endDate: string
  /** 구간 전체(startDate~endDate)가 하루도 빠짐없이 예약 가능할 때만 true */
  isAvailable: boolean
  availabilities: RoomAvailabilityDay[]
}

// GET /api/hotels/{hotelId}/rooms/{roomId}/availability — 특정 객실의 기간별 예약 가능 여부/가격 조회 (인증 불필요)
// startDate~endDate는 둘 다 포함(inclusive). 체크아웃 당일은 밤을 묵지 않으므로, 박 수를 셀 때는
// endDate에 체크아웃일 하루 전날을 넘겨야 한다.
export async function fetchRoomAvailability(
  hotelId: number,
  roomId: number,
  startDate: string,
  endDate: string,
): Promise<RoomAvailability> {
  const params = new URLSearchParams({ startDate, endDate })
  const res = await fetch(`${BASE_URL}/api/hotels/${hotelId}/rooms/${roomId}/availability?${params}`)
  return parseJsonOrThrow<RoomAvailability>(res)
}
