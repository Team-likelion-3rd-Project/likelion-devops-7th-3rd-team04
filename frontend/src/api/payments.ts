import { ApiError, authorizedFetch, fetchMyBookings as fetchMyGatewayBookings, parseJsonResponse } from './gateway'
import type { Booking } from './gateway'
import { fetchMyBookings } from './bookings'

// proto의 Payment 메시지 / gateway PaymentDto와 1:1 대응
export interface Payment {
  paymentId: number
  reservationId: number
  approvalNumber: string
  amount: number
  paymentMethod: string
  status: string
  paidAt: string
  userId: number
  /** 토스 영수증 주소. 토스 결제만 있고 MOCK 결제는 빈 문자열 (#244, 배포 전 서버에서는 없을 수 있음) */
  receiptUrl?: string
  /** 환불 완료 시각(ISO). 환불 전이면 빈 문자열 (LDP-139, 배포 전 서버에서는 없을 수 있음) */
  refundedAt?: string
}

// GET /api/payments/me — 로그인한 사용자 본인의 결제 목록을 조회한다 (인증 필요).
// payment-service가 paidAt 최신순으로 정렬해서 내려준다.
export async function fetchMyPayments(): Promise<Payment[]> {
  const res = await authorizedFetch('/api/payments/me')
  const data = await parseJsonResponse<{ payments: Payment[] }>(res)
  return data.payments
}

// ─── 새 결제 흐름: 결제 준비 → (토스 결제위젯) → 결제 승인 → 결과 확인 ──────────────────────────────
// 요청·응답 형식은 Wiki API 명세 5.8(결제 준비)·5.9(결제 승인)·5.10(실패 응답) 기준이다.

// PG 방식. payment-service 설정(MOCK/TOSS)과 같은 값으로 맞춘다.
// MOCK이면 토스 결제창 없이 바로 승인을 요청하고, 서버가 pg-mock으로 승인한다.
export type PaymentMode = 'MOCK' | 'TOSS'
export const PAYMENT_MODE: PaymentMode = import.meta.env.VITE_PAYMENT_MODE === 'TOSS' ? 'TOSS' : 'MOCK'

// 토스 결제위젯 클라이언트 키 ("결제위젯 연동 키", 공개용이라 프론트 빌드에 들어가도 된다). 백엔드 TOSS_SECRET_KEY와
// 같은 줄의 한 쌍이어야 승인된다 — API 개별 연동 키(test_ck_)와 섞으면 실패한다 (LDP-119).
export const TOSS_CLIENT_KEY: string = import.meta.env.VITE_TOSS_CLIENT_KEY ?? ''

// 승인 요청 결과. UNKNOWN·PROCESSING은 서버가 아직 확정하지 못한 상태라 결과 화면에서 다시 확인한다.
export type ConfirmResult = 'APPROVED' | 'FAILED' | 'UNKNOWN' | 'PROCESSING'

// backend 결제 API가 준비되기 전 화면 확인용 가짜 응답. 값이 있으면 아래 함수들이 서버를 호출하지 않고
// 이 결과로 응답한다 (.env의 VITE_PAYMENT_FAKE_RESULT). 실제 API 연결 후에는 비워 둔다.
const FAKE_RESULTS: ConfirmResult[] = ['APPROVED', 'FAILED', 'UNKNOWN', 'PROCESSING']
const FAKE_RESULT = FAKE_RESULTS.find((result) => result === import.meta.env.VITE_PAYMENT_FAKE_RESULT)
export const IS_PAYMENT_FAKE = FAKE_RESULT !== undefined

// POST /api/bookings/{reservationId}/payment-attempts 응답. 호출할 때마다 새 결제 시도와 새 orderId가 만들어진다.
export interface PaymentAttempt {
  orderId: string
  amount: number
  orderName: string
  paymentDueAt: string
}

// 토스 결제 성공 URL에 붙어 오는 값 그대로 보낸다. 서버는 저장된 금액과 다르면 거절한다.
export interface ConfirmPaymentRequest {
  paymentKey: string
  orderId: string
  amount: number
}

export interface ConfirmPaymentResponse {
  result: ConfirmResult
  retryable: boolean
  /** result가 FAILED일 때만 온다 (PAYMENT_DECLINED, MAX_PAYMENT_ATTEMPTS_EXCEEDED, ALREADY_PAID) */
  code?: string
  message: string
}

// 명세 5.10 실패 응답: NestJS 기본 형식에 code(오류 종류)·retryable(같은 예약으로 다시 결제 가능 여부)이 더해진다.
export class PaymentApiError extends ApiError {
  readonly retryable: boolean

  constructor(message: string, status: number, code?: string, retryable = false) {
    super(message, status, code)
    this.name = 'PaymentApiError'
    this.retryable = retryable
  }
}

// 서버 message가 비어 있을 때 쓸 안내 문구 (명세 5.8·5.9의 code 목록)
export const PAYMENT_ERROR_MESSAGE: Record<string, string> = {
  NOT_RESERVATION_OWNER: '본인 예약만 결제할 수 있습니다.',
  RESERVATION_NOT_FOUND: '예약을 찾을 수 없습니다.',
  INVALID_RESERVATION_STATUS: '결제할 수 없는 예약 상태입니다. 내 예약에서 상태를 확인해주세요.',
  PAYMENT_DUE_EXPIRED: '결제 가능 시간이 지났습니다. 예약을 다시 진행해 주세요.',
  MAX_PAYMENT_ATTEMPTS_EXCEEDED: '결제 시도 횟수(5회)를 넘어 더 이상 결제할 수 없습니다.',
  PAYMENT_ATTEMPT_NOT_FOUND: '결제 정보를 찾을 수 없습니다. 다시 결제해 주세요.',
  AMOUNT_MISMATCH: '결제 금액이 일치하지 않아 결제가 취소되었습니다.',
  PAYMENT_DECLINED: '카드 승인이 거절되었습니다. 다른 결제수단으로 다시 시도해 주세요.',
  ALREADY_PAID: '이미 결제가 완료된 예약입니다. 내 예약에서 확인해주세요.',
  PAYMENT_SERVICE_UNAVAILABLE: '결제 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
  PAYMENT_CONFIRMING: '이전 결제 결과를 확인하고 있어요. 결과가 나오면 내 예약에서 확인할 수 있고, 10분이 지나도 결과가 없으면 다시 결제할 수 있어요.',
}

export function paymentErrorMessage(code: string | undefined, message: string | undefined, fallback: string): string {
  return message || (code ? PAYMENT_ERROR_MESSAGE[code] : undefined) || fallback
}

async function parsePaymentResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // ValidationPipe(class-validator) 에러는 message가 문자열 배열로 내려온다.
    const rawMessage = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    const message = paymentErrorMessage(body?.code, rawMessage, `${res.status} ${res.statusText}`)
    throw new PaymentApiError(message, res.status, body?.code, body?.retryable === true)
  }
  return body as T
}

function fakeDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 600))
}

// 결제 준비: 결제할 금액과 주문번호를 서버에서 받는다 (금액은 서버가 계산한 값만 쓴다).
// fallback은 가짜 응답 모드에서만 쓰는 값이다 — 실제 서버는 예약 정보로 직접 계산한다.
export async function preparePayment(
  reservationId: number,
  fallback: { amount: number; orderName: string },
): Promise<PaymentAttempt> {
  if (IS_PAYMENT_FAKE) {
    await fakeDelay()
    return {
      orderId: `fake-${reservationId}-${Date.now()}`,
      amount: fallback.amount,
      orderName: fallback.orderName,
      paymentDueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }
  }

  const res = await authorizedFetch(`/api/bookings/${reservationId}/payment-attempts`, { method: 'POST' })
  return parsePaymentResponse<PaymentAttempt>(res)
}

// 가짜 응답 모드에서 PROCESSING이 언제 확정된 것으로 볼지 계산하는 기준 시각
let fakeConfirmedAt = 0

// 결제 승인: 토스(또는 MOCK)에서 받은 값으로 서버에 최종 승인을 요청한다.
export async function confirmPayment(
  reservationId: number,
  payload: ConfirmPaymentRequest,
): Promise<ConfirmPaymentResponse> {
  if (FAKE_RESULT) {
    await fakeDelay()
    fakeConfirmedAt = Date.now()
    if (FAKE_RESULT === 'FAILED') {
      return { result: 'FAILED', retryable: true, code: 'PAYMENT_DECLINED', message: '카드 승인이 거절되었습니다. (가짜 응답)' }
    }
    return { result: FAKE_RESULT, retryable: false, message: '' }
  }

  const res = await authorizedFetch(`/api/bookings/${reservationId}/payment-attempts/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parsePaymentResponse<ConfirmPaymentResponse>(res)
}

// ─── 결제 버튼 막기 (이중 결제 예방) ─────────────────────────────────────────────────────────────
// 승인을 요청하고 결과를 기다리는 중(CONFIRMING)이면 이미 돈이 빠졌을 수 있어 다시 결제하지 못하게 막는다.
// backend는 승인 요청 후 10분이 지나도 확정되지 않으면 REQUESTED로 내려 재결제를 허용한다 (LDP-67).
// 결제 마감 시각(paymentDueAt)이 지나면 결제 준비 API가 PAYMENT_DUE_EXPIRED로 거절하므로 버튼도 미리 막는다.
export type PaymentBlockReason = 'CONFIRMING' | 'DUE_EXPIRED' | 'NOT_PAYABLE'

interface PayableBooking {
  status: string
  paymentDueAt?: string
  lastPaymentAttemptStatus?: string
}

export function paymentBlockReason(booking: PayableBooking, now = Date.now()): PaymentBlockReason | null {
  if (booking.status !== 'PENDING_PAYMENT') return 'NOT_PAYABLE'
  if (booking.lastPaymentAttemptStatus === 'CONFIRMING') return 'CONFIRMING'
  const dueAt = booking.paymentDueAt ? Date.parse(booking.paymentDueAt) : NaN
  if (!Number.isNaN(dueAt) && now > dueAt) return 'DUE_EXPIRED'
  return null
}

export const PAYMENT_BLOCK_MESSAGE: Record<PaymentBlockReason, string> = {
  CONFIRMING: '결제 승인을 확인하고 있습니다. 결과가 나올 때까지 다시 결제할 수 없어요. 잠시 후 내 예약에서 확인해주세요.',
  DUE_EXPIRED: PAYMENT_ERROR_MESSAGE.PAYMENT_DUE_EXPIRED,
  NOT_PAYABLE: PAYMENT_ERROR_MESSAGE.INVALID_RESERVATION_STATUS,
}

// "10월 19일 14:30까지 (1시간 20분 남음)" 형태의 결제 마감 안내. 마감 시각이 없거나 잘못된 값이면 null.
// 마감은 서버가 정한다(LDP-92 #226): 당일 체크인은 생성 후 30분, 내일 이후 체크인은 전날 자정, 직원이 만든 예약은 만든 날 밤 자정.
// 자정 마감은 "다음 날 00:00"으로 쓰면 하루 늦게 읽히기 쉬워서 "그날 자정"으로 적는다. 아직 남아 있으면 남은 시간을 덧붙인다.
export function formatPaymentDue(paymentDueAt?: string, now = Date.now()): string | null {
  const dueAt = paymentDueAt ? new Date(paymentDueAt) : null
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null

  let label: string
  if (dueAt.getHours() === 0 && dueAt.getMinutes() === 0) {
    const day = new Date(dueAt.getTime() - 1)
    label = `${day.getMonth() + 1}월 ${day.getDate()}일 자정(밤 12시)까지`
  } else {
    const time = `${String(dueAt.getHours()).padStart(2, '0')}:${String(dueAt.getMinutes()).padStart(2, '0')}`
    label = `${dueAt.getMonth() + 1}월 ${dueAt.getDate()}일 ${time}까지`
  }

  const leftMinutes = Math.floor((dueAt.getTime() - now) / 60000)
  if (leftMinutes <= 0) return label
  const hours = Math.floor(leftMinutes / 60)
  const minutes = leftMinutes % 60
  const left = hours > 0 ? `${hours}시간${minutes > 0 ? ` ${minutes}분` : ''}` : `${minutes}분`
  return `${label} (${left} 남음)`
}

// 결제하기를 누른 순간의 최신 예약 상태. 화면이 들고 있는 예약 정보는 오래됐을 수 있어서
// (다른 탭에서 승인을 요청했거나 화면을 오래 켜 둔 경우) 결제 준비 직전에 한 번 더 확인한다.
// 목록에 없거나 조회에 실패하면 null — 이때는 서버의 결제 준비 검증에 맡긴다.
export async function fetchLatestBooking(reservationId: number): Promise<Booking | null> {
  if (IS_PAYMENT_FAKE) return null
  try {
    const bookings = await fetchMyGatewayBookings()
    return bookings.find((b) => b.reservationId === reservationId) ?? null
  } catch {
    return null
  }
}

// 결과 다시 확인 (1초 간격으로 호출).
// 내 예약 목록(GET /api/bookings/me)에서 해당 예약 상태를 본다. 결제 결과는 결제 서버 → SQS → booking-service로
// 비동기 전달되므로, 승인(APPROVED) 응답을 받은 뒤에도 예약이 RESERVED로 바뀌었는지 여기서 확인한다 (명세 5.9).
export type PaymentProgress = 'APPROVED' | 'FAILED' | 'PENDING'

export async function fetchPaymentProgress(reservationId: number): Promise<PaymentProgress> {
  if (FAKE_RESULT) {
    // APPROVED·PROCESSING은 2초 뒤 예약이 확정된 것으로, UNKNOWN은 계속 확인 중으로 둬서 각 화면을 볼 수 있게 한다.
    if ((FAKE_RESULT === 'APPROVED' || FAKE_RESULT === 'PROCESSING') && Date.now() - fakeConfirmedAt > 2000) {
      return 'APPROVED'
    }
    return 'PENDING'
  }

  const bookings = await fetchMyBookings()
  const booking = bookings.find((b) => b.reservationId === reservationId)
  if (booking?.status === 'RESERVED') return 'APPROVED'
  if (booking?.status === 'PAYMENT_FAILED' || booking?.status === 'EXPIRED') return 'FAILED'
  return 'PENDING'
}

// 결제 결과 화면 주소. 토스는 successUrl 뒤에 paymentKey·orderId·amount를 붙여 돌려보낸다.
// reservationId는 승인 API 주소에 필요해서 우리가 직접 붙여 둔다.
export function paymentSuccessUrl(reservationId: number): string {
  return `${window.location.origin}/reservation/payment/success?reservationId=${reservationId}`
}

export function paymentFailUrl(reservationId: number): string {
  return `${window.location.origin}/reservation/payment/fail?reservationId=${reservationId}`
}
