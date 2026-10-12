// 결제 관련 화면(PaymentsPage, PaymentDetailPage, PaymentCompleteModal)이 함께 쓰는 표시용 헬퍼.

// payment.paymentMethod("CARD" 등, PaymentModal이 보내는 값과 1:1 대응)를 한글 라벨로.
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CARD: '신용·체크카드',
  KAKAOPAY: '카카오페이',
  NAVERPAY: '네이버페이',
  TOSSPAY: '토스페이',
}

// payment-service의 PaymentStatus(paid/refunded, 소문자)와 1:1 대응.
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: '결제완료',
  refunded: '환불됨',
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
