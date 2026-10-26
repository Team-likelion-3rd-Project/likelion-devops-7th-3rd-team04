// 결제 관련 화면(PaymentsPage, PaymentDetailPage)이 함께 쓰는 표시용 헬퍼.

// payment.paymentMethod("CARD" 등, 2차 결제 방식에서 저장된 값)를 한글 라벨로.
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CARD: '신용·체크카드',
  KAKAOPAY: '카카오페이',
  NAVERPAY: '네이버페이',
  TOSSPAY: '토스페이',
}

// payment-service의 PaymentStatus(대문자 9종)와 1:1 대응. 화면에서 status.toLowerCase()로 찾으므로 키는 소문자.
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  processing: '결제 처리중',
  approved: '결제완료',
  failed: '결제실패',
  unknown: '결제 확인중',
  refund_requested: '환불 처리중',
  // 환불이 한 번 실패해도 서버(대사 배치)가 간격을 늘려 자동으로 다시 시도하는 중이라 "실패"로 보이지 않게 한다 (LDP-139)
  refund_failed: '환불 처리중',
  refunded: '환불됨',
  // 자동 처리를 멈추고 사람이 확인하는 상태 (#236 LDP-97) — 아래 PAYMENT_STATUS_NOTICE로 문의 안내를 함께 보여준다
  refund_manual_required: '환불 확인 필요',
  unknown_manual_required: '결제 확인 필요',
}

// 결제 상태별로 손님에게 덧붙일 안내 (LDP-139). 안내가 필요 없는 상태는 키가 없다.
export const PAYMENT_STATUS_NOTICE: Record<string, string> = {
  refund_requested: '환불을 처리하고 있어요. 결제 수단에 따라 실제 환불 반영까지 며칠 걸릴 수 있어요.',
  refund_failed: '환불을 다시 시도하고 있어요. 완료되면 상태가 바뀌어요.',
  refund_manual_required:
    '자동 환불이 완료되지 않았어요. 번거로우시겠지만 프런트 데스크(02-0000-0000)로 문의해 주세요.',
  unknown_manual_required:
    '결제 결과를 아직 확인하지 못했어요. 결제가 빠져나갔다면 프런트 데스크(02-0000-0000)로 문의해 주세요.',
}

// 환불과 관련된 결제 상태. 끝난 예약에 APPROVED가 남아 있으면 서버가 환불을 막 접수한 상태다
// (예약 취소 직후·"예약이 끝난 뒤 승인" — 환불 요청 대기열이 결제 서버로 전달하는 중, #236).
const REFUND_RELATED_STATUSES = ['APPROVED', 'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED', 'REFUND_MANUAL_REQUIRED']

// 내 결제 목록에서 이 예약의 환불 관련 결제를 찾는다 (예약당 승인 결제는 1건). 없으면 결제 전 취소 등 환불할 것이 없음.
export function findRefundPayment<T extends { reservationId: number; status: string }>(
  payments: T[],
  reservationId: number,
): T | null {
  return payments.find((p) => p.reservationId === reservationId && REFUND_RELATED_STATUSES.includes(p.status)) ?? null
}

// 곧 바뀔 상태 — 잠시 간격을 두고 다시 확인한다. REFUND_FAILED는 서버가 몇 분~1시간 간격으로 재시도하므로 기다리지 않는다.
export function isRefundAboutToChange(status: string): boolean {
  return status === 'APPROVED' || status === 'REFUND_REQUESTED'
}

// 사람이 확인해야 하는 상태 — 안내 문구를 경고 색으로 보여준다
export function isManualPaymentStatus(statusKey: string): boolean {
  return statusKey === 'refund_manual_required' || statusKey === 'unknown_manual_required'
}

// payment.paidAt("2026-08-20T10:00:00.000Z" 등 ISO 문자열)을 "YYYY.MM.DD HH:mm"으로 보여준다.
export function formatPaidAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}.${m}.${d} ${hh}:${mm}`
}
