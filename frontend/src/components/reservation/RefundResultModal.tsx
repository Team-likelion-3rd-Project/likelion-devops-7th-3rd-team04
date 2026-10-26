import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchMyPayments, type Payment } from '../../api/payments'
import { PAYMENT_METHOD_LABEL, findRefundPayment, formatPaidAt, isRefundAboutToChange } from '../../utils/payment'
import { CheckIcon } from './icons'
import '../../pages/MyPage.css'
import '../../pages/PaymentResultPage.css'
import './RefundResultModal.css'

// 환불은 결제 서버에서 비동기로 진행된다 — 보통 몇 초 안에 끝나므로 2초 간격으로 최대 30초 확인한다
const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 15

type View =
  | { kind: 'checking' } // 환불 처리 중 (확인 중)
  | { kind: 'refunded'; payment: Payment } // 환불 완료
  | { kind: 'noPayment' } // 결제 전 취소 — 환불할 것이 없음
  | { kind: 'delayed'; payment: Payment | null } // 30초 안에 끝나지 않음·자동 재시도 중 — 완료되면 내역에 반영
  | { kind: 'manual'; payment: Payment } // 자동 환불을 멈춤 (REFUND_MANUAL_REQUIRED) — 문의 안내

// 예약 취소 직후 띄우는 환불 결과 창 (LDP-139). 결제 결과 화면(PaymentSuccessPage)과 같은 카드 모양으로
// "환불 처리 중 → 환불이 완료되었습니다" 흐름을 보여준다. 결과는 내 결제 목록(GET /api/payments/me)에서 확인한다.
function RefundResultModal({ reservationId, onClose }: { reservationId: number; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'checking' })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let polls = 0

    const check = async () => {
      polls++
      let payment: Payment | null
      try {
        payment = findRefundPayment(await fetchMyPayments(), reservationId)
      } catch {
        // 조회만 실패한 것 — 취소는 끝났으므로 다시 확인해 보고, 끝내 안 되면 내역에서 확인하게 한다
        if (cancelled) return
        if (polls < MAX_POLLS) timer = setTimeout(check, POLL_INTERVAL_MS)
        else setView({ kind: 'delayed', payment: null })
        return
      }
      if (cancelled) return

      if (!payment) {
        setView({ kind: 'noPayment' })
      } else if (payment.status === 'REFUNDED') {
        setView({ kind: 'refunded', payment })
      } else if (payment.status === 'REFUND_MANUAL_REQUIRED') {
        setView({ kind: 'manual', payment })
      } else if (isRefundAboutToChange(payment.status) && polls < MAX_POLLS) {
        timer = setTimeout(check, POLL_INTERVAL_MS)
      } else {
        // REFUND_FAILED(서버가 자동 재시도 중)이거나 30초 안에 끝나지 않음
        setView({ kind: 'delayed', payment })
      }
    }

    check()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [reservationId])

  const isChecking = view.kind === 'checking'
  const payment = 'payment' in view ? view.payment : null
  const paymentPath = payment ? `/mypage/payments/${payment.paymentId}` : '/mypage/payments'

  return (
    // 확인 중에는 바깥을 눌러도 닫지 않는다 (결과를 보여주기 전에 사라지지 않게)
    <div className="mypage-modal-overlay" onClick={isChecking ? undefined : onClose}>
      <div
        className="payment-result-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="refund-result-title"
        onClick={(e) => e.stopPropagation()}
      >
        {isChecking && (
          <>
            <span className="payment-result-spinner" aria-hidden="true" />
            <h1 id="refund-result-title">환불을 처리하는 중입니다</h1>
            <p>예약이 취소되었습니다. 잠시만 기다려주세요.</p>
          </>
        )}

        {view.kind === 'refunded' && (
          <>
            <span className="payment-result-icon is-success" aria-hidden="true">
              <CheckIcon />
            </span>
            <h1 id="refund-result-title">환불이 완료되었습니다</h1>
            <p>
              {PAYMENT_METHOD_LABEL[view.payment.paymentMethod] ?? view.payment.paymentMethod}
              {view.payment.refundedAt && ` · ${formatPaidAt(view.payment.refundedAt)}`}
            </p>
            <strong className="payment-result-amount">{view.payment.amount.toLocaleString()}원</strong>
            <p>결제 수단에 따라 실제 환불 반영까지 며칠 걸릴 수 있어요.</p>
          </>
        )}

        {view.kind === 'noPayment' && (
          <>
            <span className="payment-result-icon is-success" aria-hidden="true">
              <CheckIcon />
            </span>
            <h1 id="refund-result-title">예약이 취소되었습니다</h1>
            <p>결제된 금액이 없어 환불할 내용이 없어요.</p>
          </>
        )}

        {view.kind === 'delayed' && (
          <>
            <span className="payment-result-icon is-pending" aria-hidden="true">
              …
            </span>
            <h1 id="refund-result-title">환불을 처리하고 있습니다</h1>
            <p>예약은 취소되었고, 환불에 시간이 조금 걸리고 있어요. 완료되면 결제 내역에 반영됩니다.</p>
            {view.payment && <strong className="payment-result-amount">{view.payment.amount.toLocaleString()}원</strong>}
          </>
        )}

        {view.kind === 'manual' && (
          <>
            <span className="payment-result-icon is-fail" aria-hidden="true">
              !
            </span>
            <h1 id="refund-result-title">환불 확인이 필요합니다</h1>
            <p>예약은 취소되었지만 자동 환불이 완료되지 않았어요.</p>
            <p>번거로우시겠지만 프런트 데스크(02-0000-0000)로 문의해 주세요.</p>
            <strong className="payment-result-amount">{view.payment.amount.toLocaleString()}원</strong>
          </>
        )}

        {!isChecking && (
          <div className="payment-result-actions">
            {view.kind !== 'noPayment' && (
              <Link to={paymentPath} state={payment ? { payment } : undefined} className="payment-result-secondary">
                결제 내역
              </Link>
            )}
            <button type="button" className="payment-result-primary" onClick={onClose}>
              확인
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default RefundResultModal
