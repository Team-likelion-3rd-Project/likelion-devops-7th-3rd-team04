import { authorizedFetch, parseJsonResponse } from './gateway'
import { fetchMyBookings } from './bookings'

// gateway CreatePaymentRequestDto와 1:1 대응. userId는 서버가 Authorization 헤더의 JWT에서 추출한다.
export interface CreatePaymentRequest {
  reservationId: number
  paymentMethod: string
}

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
}

// ⚠️ 2차 결제 방식. 새 결제 흐름(아래 preparePayment → confirmPayment)으로 바뀌면서 화면에서는 더 이상
// 호출하지 않는다 — backend가 POST /api/payments를 제거할 때 함께 지운다.
// POST /api/payments — 로그인한 사용자 본인 명의의 예약에 대해 결제를 요청한다 (인증 필요).
// payment-service가 예약 금액/소유자/상태를 검증하고 PG(mock)에 승인을 동기로 요청한 뒤, 성공하면
// 결제내역을 저장하고 해당 예약을 PENDING_PAYMENT -> RESERVED로 확정한다.
export async function createPayment(payload: CreatePaymentRequest): Promise<Payment> {
  const res = await authorizedFetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<Payment>(res)
}

// GET /api/payments/me — 로그인한 사용자 본인의 결제 목록을 조회한다 (인증 필요).
// payment-service가 paidAt 최신순으로 정렬해서 내려준다.
export async function fetchMyPayments(): Promise<Payment[]> {
  const res = await authorizedFetch('/api/payments/me')
  const data = await parseJsonResponse<{ payments: Payment[] }>(res)
  return data.payments
}

// ─── 새 결제 흐름: 결제 준비 → (토스 결제위젯) → 결제 승인 → 결과 확인 ──────────────────────────────
// 요청·응답 형식은 2026-10-13 백엔드(김좌형)와 합의한 내용 기준이다. Wiki API 명세가 확정되면 이름을 맞춘다.

// PG 방식. payment-service 설정(MOCK/TOSS)과 같은 값으로 맞춘다.
// MOCK이면 토스 결제창 없이 바로 승인을 요청하고, 서버가 pg-mock으로 승인한다.
export type PaymentMode = 'MOCK' | 'TOSS'
export const PAYMENT_MODE: PaymentMode = import.meta.env.VITE_PAYMENT_MODE === 'TOSS' ? 'TOSS' : 'MOCK'

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
  message: string
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
  return parseJsonResponse<PaymentAttempt>(res)
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
    return {
      result: FAKE_RESULT,
      retryable: FAKE_RESULT === 'FAILED',
      message: FAKE_RESULT === 'FAILED' ? '카드 승인이 거절되었습니다. (가짜 응답)' : '',
    }
  }

  const res = await authorizedFetch(`/api/bookings/${reservationId}/payment-attempts/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<ConfirmPaymentResponse>(res)
}

// 결과 다시 확인 (UNKNOWN·PROCESSING일 때 1초 간격으로 호출).
// 내 예약 목록(GET /api/bookings/me)에서 해당 예약 상태를 본다 — 결제가 확정되면 예약이 RESERVED로 바뀐다.
export type PaymentProgress = 'APPROVED' | 'FAILED' | 'PENDING'

export async function fetchPaymentProgress(reservationId: number): Promise<PaymentProgress> {
  if (FAKE_RESULT) {
    // PROCESSING은 3초 뒤 승인된 것으로, UNKNOWN은 계속 확인 중으로 둬서 두 경우 화면을 모두 볼 수 있게 한다.
    if (FAKE_RESULT === 'PROCESSING' && Date.now() - fakeConfirmedAt > 3000) return 'APPROVED'
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
