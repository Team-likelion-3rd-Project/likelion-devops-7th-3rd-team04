import { adminAuth } from './tokenStore'
import { refreshAdminAccessToken } from './gateway'

// 비워 두면 같은 출처의 /api/...로 호출한다 — 로컬 개발에서는 Vite 개발 서버가 /api를 클러스터로 프록시한다.
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

// api-gateway의 /api/users 응답(UserResponse)과 1:1 대응
export interface AdminUser {
  id: number
  email: string
  name: string
  phoneNumber: string
  role: string
  status: string
}

// api-gateway의 /api/hotels 응답(HotelDto)과 1:1 대응
export interface AdminHotel {
  hotelId: number
  name: string
  address: string
  phoneNumber: string
  description: string
}

// api-gateway의 RoomImageDto(요청 바디)와 1:1 대응. 저장소(MinIO·S3)에 먼저 올린 사진의 경로다 (LDP-88).
export interface AdminRoomImageInput {
  objectKey: string
}

// proto의 RoomImage / RoomDto.images 응답과 1:1 대응
export interface AdminRoomImage extends AdminRoomImageInput {
  imageId: number
  mimeType: string
  imageUrl: string // 사진 보기용 Presigned URL (1시간 뒤 만료)
  sortOrder: number
}

// 화면에서 골랐지만 아직 저장소에 올리지 않은 사진. 저장할 때 uploadAdminRoomImage로 올린다.
export interface PendingRoomImage {
  file: File
  previewUrl: string // 미리보기용 data URL
}

// api-gateway의 /api/hotels/:hotelId/rooms 응답(RoomDto)과 1:1 대응
export interface AdminRoom {
  roomId: number
  hotelId: number
  name: string
  capacity: number
  description: string
  images: AdminRoomImage[]
}

// 객실 사진으로 올릴 수 있는 형식 (hotel-service RoomImageStorage와 같은 목록)
export const ROOM_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// <input type="file">로 선택한 이미지를 미리보기와 함께 보관한다. 저장소에는 저장 버튼을 누를 때 올린다.
export function readImageFileForPreview(file: File): Promise<PendingRoomImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ file, previewUrl: reader.result as string })
    reader.onerror = () => reject(reader.error ?? new Error('이미지를 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

// api-gateway의 /api/hotels/:hotelId/rooms/:roomId/availability 응답(RoomAvailabilityDayDto)과 1:1 대응
export interface AdminRoomAvailabilityDay {
  date: string
  isAvailable: boolean
  price: number
}

// api-gateway의 /api/hotels/:hotelId/rooms/:roomId/availability 응답(RoomAvailabilityDto)과 1:1 대응
export interface AdminRoomAvailability {
  hotelId: number
  roomId: number
  startDate: string
  endDate: string
  isAvailable: boolean
  availabilities: AdminRoomAvailabilityDay[]
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new Error(message ?? `${res.status} ${res.statusText}`)
  }
  return res.json()
}

// 액세스 토큰을 Authorization 헤더에 실어 관리자 전용 API를 호출한다.
// 토큰이 만료되어 401이 오면 리프레시 토큰(쿠키)으로 한 번만 재발급을 시도한 뒤 재요청하고,
// 그마저 실패하면 로그인 세션을 정리하고 에러를 던진다 (AdminGuard가 로그인 페이지로 돌려보낸다).
function withAuthHeaders(init: RequestInit | undefined, token: string | null): RequestInit {
  return {
    ...init,
    headers: { ...init?.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'include',
  }
}

export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, withAuthHeaders(init, adminAuth.getAccessToken()))

  if (res.status !== 401) {
    return res
  }

  try {
    await refreshAdminAccessToken()
  } catch {
    adminAuth.clearAccessToken()
    throw new Error('로그인이 만료되었습니다. 다시 로그인해주세요.')
  }

  return fetch(`${BASE_URL}${path}`, withAuthHeaders(init, adminAuth.getAccessToken()))
}

// POST/PUT 등 JSON body를 실어 보내는 관리자 API 공용 헬퍼.
export function authedJsonFetch(path: string, method: 'POST' | 'PUT', body: unknown): Promise<Response> {
  return authedFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// GET /api/users?keyword=&page=&size= (관리자 전용) - 이름·이메일·연락처로 회원 검색 (LDP-136, 최근 가입 순)
export async function searchAdminUsers(
  keyword: string,
  page = 1,
  size = 20,
): Promise<{ users: AdminUser[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (keyword.trim()) params.set('keyword', keyword.trim())
  const res = await authedFetch(`/api/users?${params}`)
  const data = await parseJson<{ users?: AdminUser[]; total?: number }>(res)
  return { users: data.users ?? [], total: data.total ?? 0 }
}

// GET /api/users (관리자 전용) - 전체 유저 목록
export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await authedFetch('/api/users')
  const data = await parseJson<{ users: AdminUser[] }>(res)
  // 목록이 비어있으면 gRPC 응답의 repeated 필드가 undefined로 내려올 수 있어 방어적으로 처리한다.
  return data.users ?? []
}

// GET /api/users/:userId (관리자 전용) - 유저 상세
export async function fetchAdminUserById(userId: string | number): Promise<AdminUser> {
  const res = await authedFetch(`/api/users/${userId}`)
  return parseJson<AdminUser>(res)
}

// GET /api/hotels - 전체 호텔 목록 (공개 API지만 관리자 화면에서도 동일하게 사용)
export async function fetchAdminHotels(): Promise<AdminHotel[]> {
  const res = await authedFetch('/api/hotels')
  const data = await parseJson<{ hotels: AdminHotel[] }>(res)
  return data.hotels ?? []
}

// GET /api/hotels/:hotelId - 호텔 상세
export async function fetchAdminHotelById(hotelId: string | number): Promise<AdminHotel> {
  const res = await authedFetch(`/api/hotels/${hotelId}`)
  return parseJson<AdminHotel>(res)
}

// GET /api/hotels/:hotelId/rooms - 호텔의 객실 목록
export async function fetchAdminHotelRooms(hotelId: string | number): Promise<AdminRoom[]> {
  const res = await authedFetch(`/api/hotels/${hotelId}/rooms`)
  const data = await parseJson<{ rooms: AdminRoom[] }>(res)
  return data.rooms ?? []
}

// api-gateway의 GET /api/bookings/hotels/:hotelId/stats 응답과 1:1 대응. 점유율 분모(총 객실 수)는
// 여기 포함되지 않으므로 fetchAdminHotelRooms의 결과와 함께 조합해서 써야 한다.
export interface AdminHotelStats {
  checkInsToday: number
  checkOutsToday: number
  occupiedRoomsToday: number
  newReservationsToday: number
  cancellationsToday: number
  revenueToday: number
}

// GET /api/bookings/hotels/:hotelId/stats - 호텔의 오늘자 예약 지표
export async function fetchAdminHotelStats(hotelId: string | number): Promise<AdminHotelStats> {
  const res = await authedFetch(`/api/bookings/hotels/${hotelId}/stats`)
  return parseJson<AdminHotelStats>(res)
}

// GET /api/hotels/:hotelId/rooms/:roomId - 객실 상세
export async function fetchAdminRoomById(
  hotelId: string | number,
  roomId: string | number,
): Promise<AdminRoom> {
  const res = await authedFetch(`/api/hotels/${hotelId}/rooms/${roomId}`)
  return parseJson<AdminRoom>(res)
}

// GET /api/hotels/:hotelId/rooms/:roomId/availability - 특정 기간 객실 예약 가능 여부(날짜별 가격 포함) 조회
export async function fetchAdminRoomAvailability(
  hotelId: string | number,
  roomId: string | number,
  startDate: string,
  endDate: string,
): Promise<AdminRoomAvailability> {
  const query = new URLSearchParams({ startDate, endDate })
  const res = await authedFetch(`/api/hotels/${hotelId}/rooms/${roomId}/availability?${query}`)
  return parseJson<AdminRoomAvailability>(res)
}

// api-gateway의 CreateRoomDto/UpdateRoomDto와 1:1 대응되는 요청 바디
// 주의: images는 항상 전체 교체(PUT 시맨틱)이므로, 수정 시 기존 이미지를 유지하려면
// 그대로 다시 포함해서 보내야 한다 (비우면 서버가 기존 이미지를 전부 삭제한다).
export interface AdminRoomInput {
  name: string
  capacity: number
  description?: string
  images?: AdminRoomImageInput[]
}

// POST /api/hotels/:hotelId/rooms (관리자 전용) - 신규 객실 등록
// 사진은 저장 경로에 객실 id가 들어가서 등록할 때는 보내지 않는다. 등록 후 uploadAdminRoomImage → updateAdminRoom으로 붙인다.
export async function createAdminRoom(
  hotelId: string | number,
  input: Omit<AdminRoomInput, 'images'>,
): Promise<AdminRoom> {
  const res = await authedJsonFetch(`/api/hotels/${hotelId}/rooms`, 'POST', input)
  return parseJson<AdminRoom>(res)
}

// PUT /api/hotels/:hotelId/rooms/:roomId (관리자 전용) - 기존 객실 정보 수정
export async function updateAdminRoom(
  hotelId: string | number,
  roomId: string | number,
  input: AdminRoomInput,
): Promise<AdminRoom> {
  const res = await authedJsonFetch(`/api/hotels/${hotelId}/rooms/${roomId}`, 'PUT', input)
  return parseJson<AdminRoom>(res)
}

// 객실 사진 1장을 저장소(MinIO·S3)에 올리고, 객실 수정의 images에 넣을 objectKey를 돌려준다 (LDP-88).
// 1) POST /api/hotels/:hotelId/rooms/:roomId/images/upload-url (관리자 전용)로 업로드 URL을 받고
// 2) 그 주소로 파일을 직접 PUT한다. 형식·크기가 서명에 들어가 있어 요청할 때 보낸 값과 같아야 한다.
export async function uploadAdminRoomImage(
  hotelId: string | number,
  roomId: string | number,
  file: File,
): Promise<string> {
  const res = await authedJsonFetch(`/api/hotels/${hotelId}/rooms/${roomId}/images/upload-url`, 'POST', {
    mimeType: file.type,
    size: file.size,
  })
  const { uploadUrl, objectKey } = await parseJson<{ uploadUrl: string; objectKey: string }>(res)

  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!upload.ok) {
    throw new Error(`${file.name}을(를) 올리지 못했습니다. (${upload.status})`)
  }
  return objectKey
}

// DELETE /api/hotels/:hotelId/rooms/:roomId (관리자 전용) - 객실 삭제
// TODO: 백엔드 삭제 API가 아직 구현되어 있지 않음. 구현되는 대로 응답 스펙에 맞춰 확인 필요.
export async function deleteAdminRoom(hotelId: string | number, roomId: string | number): Promise<void> {
  const res = await authedFetch(`/api/hotels/${hotelId}/rooms/${roomId}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new Error(message ?? `${res.status} ${res.statusText}`)
  }
}
