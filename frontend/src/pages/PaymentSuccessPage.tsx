import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { isUnauthorized, refreshAccessToken } from '../api/gateway'
import {
  PAYMENT_ERROR_MESSAGE,
  PaymentApiError,
  confirmPayment,
  fetchPaymentProgress,
  paymentErrorMessage,
} from '../api/payments'
import { customerAuth } from '../api/tokenStore'
import { CheckIcon } from '../components/reservation/icons'
import './PaymentResultPage.css'

// 승인 요청 뒤에는 예약이 RESERVED로 바뀌었는지 1초 간격으로 최대 10초까지 다시 확인한다 (명세 5.9).
// - APPROVED: 결제는 승인됐고, 결과가 SQS로 booking-service에 전달돼 예약이 확정되기를 기다린다.
// - UNKNOWN·PROCESSING: 서버가 아직 결제를 확정하지 못했다. 대사 배치가 토스 조회로 확정한다.
// 10초 안에 확정되지 않으면 "확정 처리 중"으로 안내하고 내 예약에서 확인하게 한다.
const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 10_000

type ViewState =
  | { kind: 'confirming' }
  | { kind: 'checking'; approved: boolean }
  | { kind: 'approved' }
  | { kind: 'failed'; message: string; retryable: boolean }
  | { kind: 'pending'; approved: boolean }
  | { kind: 'error'; message: string }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 결제 성공 URL(/reservation/payment/success). 토스 결제창(또는 MOCK)에서 돌아오면 쿼리의
 * paymentKey·orderId·amount로 서버에 승인을 요청하고, 결과(승인·실패·확인 중)를 보여준다. */
function PaymentSuccessPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [view, setView] = useState<ViewState>({ kind: 'confirming' })
  // 개발 모드(StrictMode)에서 effect가 두 번 실행돼도 승인 요청은 한 번만 보낸다.
  const requestedRef = useRef(false)

  const reservationId = Number(searchParams.get('reservationId'))
  const paymentKey = searchParams.get('paymentKey') ?? ''
  const orderId = searchParams.get('orderId') ?? ''
  const amount = Number(searchParams.get('amount'))
  // 주소를 직접 입력했거나 값이 빠진 경우에는 승인 요청을 보내지 않는다.
  const hasValidParams = reservationId > 0 && paymentKey !== '' && orderId !== '' && amount > 0

  useEffect(() => {
    if (!hasValidParams || requestedRef.current) return
    requestedRef.current = true

    async function run() {
      try {
        // 토스 결제창에서 돌아오면 페이지가 새로 열려 메모리의 액세스 토큰이 비어 있다 → 쿠키로 먼저 복구한다.
        if (!customerAuth.getAccessToken()) await refreshAccessToken()

        const response = await confirmPayment(reservationId, { paymentKey, orderId, amount })
        if (response.result === 'FAILED') {
          setView({
            kind: 'failed',
            message: paymentErrorMessage(response.code, response.message, '결제가 승인되지 않았습니다.'),
            retryable: response.retryable,
          })
          return
        }

        // APPROVED·UNKNOWN·PROCESSING 모두 예약이 확정됐는지 다시 확인한다.
        const approved = response.result === 'APPROVED'
        setView({ kind: 'checking', approved })
        const startedAt = Date.now()
        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          await sleep(POLL_INTERVAL_MS)
          const progress = await fetchPaymentProgress(reservationId)
          if (progress === 'APPROVED') {
            setView({ kind: 'approved' })
            return
          }
          if (progress === 'FAILED') {
            setView({ kind: 'failed', message: '', retryable: false })
            return
          }
        }
        setView({ kind: 'pending', approved })
      } catch (err) {
        if (isUnauthorized(err)) {
          navigate('/login')
          return
        }
        // 같은 예약의 이전 결제 결과를 아직 확인 중이라 이번 승인이 거절된 경우(409 PAYMENT_CONFIRMING, #200).
        // 이번 시도는 결제되지 않았지만 이전 시도가 승인될 수 있으므로, 실패가 아니라 "확인 중"으로 안내한다.
        if (err instanceof PaymentApiError && err.code === 'PAYMENT_CONFIRMING') {
          setView({ kind: 'error', message: PAYMENT_ERROR_MESSAGE.PAYMENT_CONFIRMING })
          return
        }
        // 서버가 요청을 확인하고 거절한 경우(금액 불일치, 결제 기한 만료 등 4xx)는 결제가 안 된 것이 확실하다 (명세 5.10).
        if (err instanceof PaymentApiError && err.status >= 400 && err.status < 500) {
          setView({ kind: 'failed', message: err.message, retryable: err.retryable })
          return
        }
        // 승인 요청이 서버에 닿았는지 알 수 없으므로 실패로 단정하지 않고 내 예약에서 확인하게 한다.
        setView({
          kind: 'error',
          message: err instanceof Error ? err.message : '결제 결과를 확인하지 못했습니다.',
        })
      }
    }

    run()
  }, [hasValidParams, reservationId, paymentKey, orderId, amount, navigate])

  const reservationPath = `/mypage/reservations/${reservationId}`
  const current: ViewState = hasValidParams
    ? view
    : { kind: 'error', message: '결제 정보가 올바르지 않습니다. 내 예약에서 결제 상태를 확인해주세요.' }

  return (
    <section className="payment-result-page">
      <div className="payment-result-card">
        {(current.kind === 'confirming' || current.kind === 'checking') && (
          <>
            <span className="payment-result-spinner" aria-hidden="true" />
            <h1>
              {current.kind === 'confirming'
                ? '결제를 승인하는 중입니다'
                : current.approved
                  ? '결제가 승인되었습니다. 예약을 확정하는 중입니다'
                  : '결제 결과를 확인하는 중입니다'}
            </h1>
            <p>잠시만 기다려주세요. 이 화면을 닫거나 새로고침하지 마세요.</p>
          </>
        )}

        {current.kind === 'approved' && (
          <>
            <span className="payment-result-icon is-success" aria-hidden="true">
              <CheckIcon />
            </span>
            <h1>결제가 완료되었습니다</h1>
            <p>예약이 확정되었습니다.</p>
            {amount > 0 && <strong className="payment-result-amount">{amount.toLocaleString()}원</strong>}
            <div className="payment-result-actions">
              <Link to="/mypage/payments" className="payment-result-secondary">
                결제 내역
              </Link>
              <Link to={reservationPath} className="payment-result-primary">
                예약 확인
              </Link>
            </div>
          </>
        )}

        {current.kind === 'failed' && (
          <>
            <span className="payment-result-icon is-fail" aria-hidden="true">
              !
            </span>
            <h1>결제에 실패했습니다</h1>
            <p>{current.message || '결제가 승인되지 않았습니다.'}</p>
            {!current.retryable && <p>다시 결제할 수 없는 상태입니다. 내 예약에서 상태를 확인해주세요.</p>}
            <div className="payment-result-actions">
              <Link to="/mypage/reservations" className="payment-result-secondary">
                내 예약
              </Link>
              {current.retryable && (
                <Link to={reservationPath} className="payment-result-primary">
                  다시 결제하기
                </Link>
              )}
            </div>
          </>
        )}

        {(current.kind === 'pending' || current.kind === 'error') && (
          <>
            <span className="payment-result-icon is-pending" aria-hidden="true">
              …
            </span>
            <h1>결제 확정 처리 중입니다</h1>
            <p>
              {current.kind === 'error'
                ? current.message
                : current.approved
                  ? '결제는 승인되었고, 예약 확정에 시간이 걸리고 있습니다. 확정되면 내 예약에 반영됩니다.'
                  : '결제 결과를 확인하는 데 시간이 걸리고 있습니다. 확정되면 내 예약에 반영됩니다.'}
            </p>
            <p>중복 결제를 막기 위해, 확정될 때까지 다시 결제하지 마세요.</p>
            <div className="payment-result-actions">
              <Link to={reservationPath} className="payment-result-primary">
                내 예약에서 확인
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default PaymentSuccessPage
