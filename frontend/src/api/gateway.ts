import { customerAuth, adminAuth } from './tokenStore'
import type { AuthStore } from './tokenStore'

// 비워 두면 같은 출처의 /api/...로 호출한다 — 로컬 개발에서는 Vite 개발 서버가 /api를 클러스터로 프록시한다.
const BASE_URL = import.meta.env.VITE_API_URL ?? ''

// 호출부가 "진짜 인증 실패(401)"와 그 외 실패(429/5xx/네트워크 오류 등)를 구분할 수 있도록 HTTP
// status를 함께 담아 던진다. 401만 로그아웃/재로그인 유도(navigate('/login'))로 이어져야 하고,
// 나머지는 일시적 오류로 다뤄야 한다(강제 로그아웃 금지) — 아래 isUnauthorized() 참고.
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// 각 페이지의 재조회 실패 처리에서 "진짜 로그인이 필요한 상태"만 걸러낼 때 쓴다.
export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

// 429(Too Many Requests) 자동 재시도 설정. api-gateway의 ThrottlerGuard는 요청이 실제 라우트
// 핸들러에 도달하기 전에 거부하므로(부작용 없음), GET/POST/PUT/DELETE 어떤 메서드든 재시도해도
// 안전하다. Retry-After 헤더(초 단위, 서버가 실어 보냄)를 최우선으로 존중하고, 없으면 지수
// 백오프 + jitter로 대체한다.
//
// 429는 "고장"이 아니라 "잠깐 후 다시 오면 100% 성공하는 상태"라, 재시도 횟수가 아니라 누적 대기
// 시간으로 얼마나 참을지를 정한다 — 라우트마다 Retry-After 크기가 다르기 때문이다(예: /refresh는
// 창을 10초로 짧게 잡아 최대 대기가 10초 안팎이라 이 예산 안에서 2~3번 조용히 재시도되지만, 더 긴
// 창을 쓰는 라우트는 Retry-After 자체가 이 예산을 넘을 수 있어 그 즉시 포기하고 호출부로 넘긴다).
// 이 예산을 넘기 전까지는 호출부(페이지)에 에러를 보여주지 않고 "불러오는 중" 상태 그대로 조용히
// 재시도만 계속한다 — 429는 사용자에게 실패로 보여줄 이유가 없는 상태이기 때문이다.
const MAX_RATE_LIMIT_WAIT_MS = 30_000
const MAX_RATE_LIMIT_RETRIES = 8 // 무한루프 방지용 상한(위 시간 예산이 사실상 먼저 걸림)
const RETRY_BASE_DELAY_MS = 300
const RETRY_MAX_DELAY_MS = 5_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffDelayMs(attempt: number): number {
  const exp = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt)
  return exp + Math.random() * RETRY_BASE_DELAY_MS
}

async function fetchWithRateLimitRetry(input: string, init: RequestInit): Promise<Response> {
  let waitedMs = 0

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, init)
    if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return res

    const retryAfterSec = Number(res.headers.get('Retry-After'))
    const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec >= 0
      ? retryAfterSec * 1000
      : backoffDelayMs(attempt)

    // 이번에 기다릴 시간까지 더하면 예산을 넘는다 — 더 참는 게 오히려 "멈춘 화면"처럼 보이니
    // 여기서 포기하고 429 응답을 그대로 호출부에 돌려줘 에러 상태로 넘어가게 한다.
    if (waitedMs + delayMs > MAX_RATE_LIMIT_WAIT_MS) return res

    await sleep(delayMs)
    waitedMs += delayMs
  }
}

export interface HelloResponse {
  message: string
}

export interface ServiceConfig {
  key: string
  label: string
  path: string
}

// api-gateway(3000)가 gRPC로 프록시하는 서비스별 테스트 엔드포인트 목록
export const SERVICES: ServiceConfig[] = [
  { key: 'users', label: 'User Service', path: '/api/users/hello' },
  { key: 'hotels', label: 'Hotel Service', path: '/api/hotels/hello' },
  { key: 'bookings', label: 'Booking Service', path: '/api/bookings/hello' },
  { key: 'payments', label: 'Payment Service', path: '/api/payments/hello' },
  { key: 'chat-bots', label: 'Chat-bot Service', path: '/api/chat-bots/hello' },
]

export async function fetchHello(path: string): Promise<HelloResponse> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json()
}

export interface LoginRequest {
  email: string
  password: string
}

// 서버가 리프레시 토큰은 httpOnly 쿠키로 내려주고, 응답 바디에는 액세스 토큰 + 유저 정보만 담아준다.
export interface AuthResponse {
  accessToken: string
  userId: number
  email: string
  name: string
  role: string
}

// store 인자로 고객(customerAuth)/관리자(adminAuth) 중 어느 메모리 저장소에 반영할지 정한다.
async function parseAuthResponse(res: Response, store: AuthStore): Promise<AuthResponse> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    // ValidationPipe(class-validator) 에러는 message가 문자열 배열로 내려온다 (필드별 검증 메시지 여러 개).
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new ApiError(message ?? `${res.status} ${res.statusText}`, res.status)
  }

  const data: AuthResponse = await res.json()
  store.setAuth(data.accessToken, {
    userId: data.userId,
    email: data.email,
    name: data.name,
    role: data.role,
  })
  return data
}

// api-gateway(/api/auth/login) -> auth-service(gRPC)로 이메일/비밀번호를 검증하고 토큰을 발급받는다.
// credentials: 'include'가 있어야 서버가 Set-Cookie로 내려주는 httpOnly 리프레시 토큰을 브라우저가 저장한다.
export async function login(payload: LoginRequest): Promise<AuthResponse> {
  const res = await fetchWithRateLimitRetry(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  return parseAuthResponse(res, customerAuth)
}

export interface RegisterRequest {
  email: string
  password: string
  name: string
  phoneNumber: string
}

// api-gateway(/api/auth/register) -> auth-service(gRPC)로 회원가입을 요청하고, 성공 시 로그인과 동일하게 토큰을 발급받는다.
export async function register(payload: RegisterRequest): Promise<AuthResponse> {
  const res = await fetchWithRateLimitRetry(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  return parseAuthResponse(res, customerAuth)
}

// 액세스 토큰(메모리)을 Authorization 헤더에 실어 보내는 공통 fetch. 마이페이지 등 로그인 필요한 API에서 사용.
// bookings.ts/payments.ts도 각자 fetch를 직접 구현하지 않고 이 함수를 재사용한다(429 재시도 포함).
export async function authorizedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = customerAuth.getAccessToken()
  return fetchWithRateLimitRetry(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

export async function parseJsonResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // ValidationPipe(class-validator) 에러는 message가 문자열 배열로 내려온다 (필드별 검증 메시지 여러 개).
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new ApiError(message ?? `${res.status} ${res.statusText}`, res.status)
  }
  return body as T
}

// proto의 User 메시지와 1:1 대응되는 응답 형태 (api-gateway UserController의 UserResponse와 동일)
export interface UserProfile {
  id: number
  email: string
  name: string
  phoneNumber: string
  role: string
  status: string
}

// api-gateway(GET /api/users/me) -> user-service(gRPC)로 로그인한 사용자 본인의 프로필을 조회한다.
export async function fetchMe(): Promise<UserProfile> {
  const res = await authorizedFetch('/api/users/me')
  return parseJsonResponse<UserProfile>(res)
}

export interface UpdateMeRequest {
  name: string
  phoneNumber: string
}

// api-gateway(PUT /api/users/me) -> user-service(gRPC)로 이름/전화번호를 수정한다.
export async function updateMe(payload: UpdateMeRequest): Promise<UserProfile> {
  const res = await authorizedFetch('/api/users/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const profile = await parseJsonResponse<UserProfile>(res)
  // 헤더의 "OO님" 표시 등이 즉시 반영되도록 메모리에 캐시된 유저 정보도 함께 갱신한다.
  customerAuth.setUser({ userId: profile.id, email: profile.email, name: profile.name, role: profile.role })
  return profile
}

// api-gateway(DELETE /api/users/me) -> auth-service(gRPC)로 회원 탈퇴를 요청한다.
// 성공 시 서버의 프로필/자격증명/세션이 모두 정리되므로, 클라이언트도 메모리의 액세스 토큰을 즉시 버린다.
export async function withdrawMe(): Promise<{ message: string }> {
  const res = await authorizedFetch('/api/users/me', { method: 'DELETE' })
  const result = await parseJsonResponse<{ message: string }>(res)
  customerAuth.clearAccessToken()
  return result
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

// api-gateway(PATCH /api/auth/password) -> auth-service(gRPC)로 비밀번호를 변경한다.
// 성공 시 서버가 이 계정의 모든 리프레시 토큰(세션)을 무효화하므로, 프론트도 이어서 로그아웃 처리를 해야 한다.
export async function changePassword(payload: ChangePasswordRequest): Promise<{ message: string }> {
  const res = await authorizedFetch('/api/auth/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<{ message: string }>(res)
}

// api-gateway(/api/auth/admin/login) -> auth-service(gRPC)로 이메일/비밀번호를 검증하고 토큰을 발급받는다.
// 고객 로그인(login)과 엔드포인트가 완전히 분리되어 있으며, admins 테이블에 등록된 계정만 성공한다
// (customers 계정으로는 애초에 이메일 조회 단계에서 실패하므로 role을 별도로 검증할 필요가 없다).
export async function adminLogin(payload: LoginRequest): Promise<AuthResponse> {
  const res = await fetchWithRateLimitRetry(`${BASE_URL}/api/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  return parseAuthResponse(res, adminAuth)
}

// 백엔드가 리프레시 토큰을 매 재발급마다 로테이션(재발급 즉시 이전 리프레시 토큰을 무효화)하기
// 때문에, 같은 순간 여러 컴포넌트(App 부팅, AccountLayout의 뱃지 조회, 각 페이지의 재조회 등)가
// 동시에 refreshAccessToken()을 호출하면 첫 번째 요청만 성공하고 나머지는 이미 무효화된 리프레시
// 토큰으로 요청하게 되어 401을 받는다 — 그 결과로 로그인 상태인데도 로그아웃 처리되거나 일부
// 정보만 빈 채로 남는 등 "꼬인" 것처럼 보이는 증상이 생긴다. 진행 중인 요청이 있으면 새 요청을
// 보내지 않고 그 Promise를 그대로 공유해서, 실제 네트워크 호출은 항상 하나만 나가도록 한다.
let refreshInFlight: Promise<AuthResponse> | null = null

// httpOnly 리프레시 토큰 쿠키(refreshToken, 고객 전용)로 액세스 토큰을 재발급받는다. 새로고침 등으로
// 메모리의 액세스 토큰이 사라졌을 때 세션을 복구하는 용도 (쿠키가 없거나 만료됐으면 401 -> 비로그인 상태로 처리).
export async function refreshAccessToken(): Promise<AuthResponse> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const res = await fetchWithRateLimitRetry(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    return parseAuthResponse(res, customerAuth)
  })()

  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
  }
}

// proto의 Booking 메시지와 1:1 대응되는 응답 형태 (api-gateway BookingController의 BookingDto와 동일).
// 편의시설(수영장/라운지) 이용 여부/인원수는 여기 담기지 않는다 — fetchReservationFacilities로 별도 조회한다.
export interface Booking {
  reservationId: number
  userId: number
  roomId: number
  checkInDate: string
  checkOutDate: string
  guestCount: number
  totalAmount: number
  status: 'PENDING_PAYMENT' | 'RESERVED' | 'CANCELLED' | 'COMPLETED'
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

// api-gateway(GET /api/bookings/me) -> booking-service(gRPC)로 로그인한 사용자 본인의 예약 목록을 조회한다.
export async function fetchMyBookings(): Promise<Booking[]> {
  const res = await authorizedFetch('/api/bookings/me')
  const data = await parseJsonResponse<{ bookings: Booking[] }>(res)
  return data.bookings
}

// api-gateway(PUT /api/bookings/{reservationId}) -> booking-service(gRPC)로 예약을 취소한다.
export async function cancelBooking(reservationId: number): Promise<Booking> {
  const res = await authorizedFetch(`/api/bookings/${reservationId}`, { method: 'PUT' })
  return parseJsonResponse<Booking>(res)
}

// api-gateway(GET /api/bookings/{reservationId}/facilities) -> booking-service(gRPC)로 해당 예약에
// 연결된 편의시설(수영장/라운지 등) 이용 내역을 조회한다. 본인 예약이 아니면 403.
export async function fetchReservationFacilities(reservationId: number): Promise<ReservationFacility[]> {
  const res = await authorizedFetch(`/api/bookings/${reservationId}/facilities`)
  const data = await parseJsonResponse<{ facilities: ReservationFacility[] }>(res)
  return data.facilities
}

// proto의 SendMessageResponse 메시지와 1:1 대응되는 응답 형태
export interface ChatBotMessageResponse {
  sessionId: string
  reply: string
  createdAt: string
}

// api-gateway(POST /api/chat-bots/messages) -> chat-bot-service(gRPC)로 챗봇 응답을 요청한다.
// authorizedFetch를 쓰므로 로그인 상태면 Authorization 헤더가 자동으로 실려 대화가 세션에 이어지고,
// 비로그인이면 토큰 없이 호출되어 이력을 남기지 않는 1회성 질문으로 처리된다(둘 다 이 함수 하나로 처리).
// IP당 분당 10회로 rate limit이 걸려 있어 초과 시 429가 온다.
export async function sendChatMessage(message: string): Promise<ChatBotMessageResponse> {
  const res = await authorizedFetch('/api/chat-bots/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  return parseJsonResponse<ChatBotMessageResponse>(res)
}

// refreshAccessToken()과 동일한 이유(리프레시 토큰 로테이션 + 동시 호출 경쟁)로 진행 중인 요청을 공유한다.
let adminRefreshInFlight: Promise<AuthResponse> | null = null

// 관리자 전용 재발급. adminRefreshToken 쿠키를 사용하며, 고객 세션(refreshToken)에는 영향을 주지 않는다.
export async function refreshAdminAccessToken(): Promise<AuthResponse> {
  if (adminRefreshInFlight) return adminRefreshInFlight

  adminRefreshInFlight = (async () => {
    const res = await fetchWithRateLimitRetry(`${BASE_URL}/api/auth/admin/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    return parseAuthResponse(res, adminAuth)
  })()

  try {
    return await adminRefreshInFlight
  } finally {
    adminRefreshInFlight = null
  }
}

// 서버에 로그아웃을 알려 리프레시 토큰(쿠키)을 무효화하고, 메모리의 액세스 토큰도 즉시 버린다.
// 서버 호출이 실패해도(네트워크 오류 등) 클라이언트 쪽 로그인 상태는 반드시 해제한다.
async function logoutFrom(store: AuthStore): Promise<void> {
  const token = store.getAccessToken()

  try {
    if (token) {
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      })
    }
  } finally {
    store.clearAccessToken()
  }
}

// 고객 로그아웃. 서버는 Authorization 헤더의 액세스 토큰으로 principal 타입을 판별해
// refreshToken 쿠키만 지우므로, 같은 브라우저의 관리자 세션(adminRefreshToken)에는 영향이 없다.
export function logout(): Promise<void> {
  return logoutFrom(customerAuth)
}

// 관리자 로그아웃. adminAuth 스토어와 adminRefreshToken 쿠키만 정리한다.
export function adminLogout(): Promise<void> {
  return logoutFrom(adminAuth)
}
