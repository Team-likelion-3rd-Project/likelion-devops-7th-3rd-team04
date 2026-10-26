import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchMyPayments, type Payment } from '../../api/payments'
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_NOTICE,
  findRefundPayment,
  formatPaidAt,
  isManualPaymentStatus,
  isRefundAboutToChange,
} from '../../utils/payment'
import '../../pages/PaymentDetailPage.css'
import './RefundStatusSection.css'

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 10

// 취소·만료·결제 실패 예약의 환불 진행 상황 (LDP-139).
// 예약 응답에는 환불 정보가 없어서 내 결제 목록(GET /api/payments/me)에서 같은 예약의 결제를 찾는다.
// 환불은 결제 서버에서 비동기로 진행되므로, 처리 중이면 3초 간격으로 최대 10번 다시 확인한다.
function RefundStatusSection({ reservationId }: { reservationId: number }) {
  const [payment, setPayment] = useState<Payment | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let polls = 0

    const load = async () => {
      try {
        const payments = await fetchMyPayments()
        if (cancelled) return
        const found = findRefundPayment(payments, reservationId)
        setPayment(found)
        setLoadError(false)
        if (found && isRefundAboutToChange(found.status) && polls < MAX_POLLS) {
          polls++
          timer = setTimeout(load, POLL_INTERVAL_MS)
        }
      } catch {
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setIsLoaded(true)
      }
    }

    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [reservationId])

  if (!isLoaded) {
    return <p className="mypage-hint">환불 정보를 불러오는 중...</p>
  }
  if (loadError && !payment) {
    return <p className="mypage-hint">환불 정보를 불러오지 못했어요. 결제 내역에서 확인해 주세요.</p>
  }
  if (!payment) {
    return <p className="mypage-hint">결제된 금액이 없어 환불할 내용이 없어요.</p>
  }

  // 끝난 예약에 남은 승인 결제 = 환불 접수됨 (결제 목록에서는 "결제완료"로 보이므로 여기서만 바꿔 보여준다)
  const isAccepted = payment.status === 'APPROVED'
  const statusKey = isAccepted ? 'refund_requested' : payment.status.toLowerCase()
  const statusLabel = isAccepted ? '환불 접수' : (PAYMENT_STATUS_LABEL[statusKey] ?? payment.status)
  const notice = isAccepted
    ? '환불 요청을 접수했어요. 잠시 후 환불 처리 상태로 바뀌어요.'
    : PAYMENT_STATUS_NOTICE[statusKey]

  return (
    <div className="refund-status">
      <h3 className="refund-status-title">환불 정보</h3>
      <div className="reservation-detail-rows">
        <div className="reservation-detail-row">
          <span className="reservation-detail-label">환불 상태</span>
          <span className={`payment-status payment-status-${statusKey}`}>{statusLabel}</span>
        </div>
        <div className="reservation-detail-row">
          <span className="reservation-detail-label">환불 금액</span>
          <span className="reservation-detail-value reservation-detail-amount">
            {payment.amount.toLocaleString()}원
          </span>
        </div>
        <div className="reservation-detail-row">
          <span className="reservation-detail-label">결제 수단</span>
          <span className="reservation-detail-value">
            {PAYMENT_METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod}
          </span>
        </div>
        {payment.refundedAt && (
          <div className="reservation-detail-row">
            <span className="reservation-detail-label">환불일시</span>
            <span className="reservation-detail-value">{formatPaidAt(payment.refundedAt)}</span>
          </div>
        )}
      </div>

      {notice && <p className={isManualPaymentStatus(statusKey) ? 'mypage-warning' : 'mypage-hint'}>{notice}</p>}

      <div className="mypage-actions">
        <Link to={`/mypage/payments/${payment.paymentId}`} state={{ payment }} className="mypage-ghost-btn">
          결제 상세보기
        </Link>
        {/* 토스 영수증에서 취소 내역도 확인할 수 있다 (토스 결제만, #244) */}
        {payment.receiptUrl && (
          <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer" className="mypage-ghost-btn">
            영수증 보기
          </a>
        )}
      </div>
    </div>
  )
}

export default RefundStatusSection
