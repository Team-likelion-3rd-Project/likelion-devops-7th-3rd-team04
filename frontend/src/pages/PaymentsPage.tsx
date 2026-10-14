import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isUnauthorized, refreshAccessToken } from '../api/gateway'
import { fetchMyPayments, type Payment } from '../api/payments'
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, formatPaidAt } from '../utils/payment'
import { currentLoginState } from '../utils/loginRedirect'
import './MyPage.css'
import './PaymentsPage.css'

// 마이페이지 > 결제 내역(/mypage/payments). 내가 결제했던 내역을 최신순으로 보여주고, 클릭하면
// 결제 상세 페이지(PaymentDetailPage, /mypage/payments/:paymentId)로 이동한다.
function PaymentsPage() {
  const navigate = useNavigate()

  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setLoadError('')
      try {
        const data = await fetchMyPayments()
        if (!cancelled) setPayments(data)
      } catch (err) {
        if (cancelled) return
        // fetchMyPayments()는 429 등을 이미 내부에서(요청 자체) 예산껏 재시도했다. 진짜 로그인이
        // 필요한 상태(401)가 아니면 재발급을 또 시도하지 않는다 — 안 그러면 이미 몰린 요청에
        // 부하만 배가된다.
        if (!isUnauthorized(err)) {
          setLoadError('일시적으로 결제 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다.
        try {
          await refreshAccessToken()
          const data = await fetchMyPayments()
          if (!cancelled) setPayments(data)
        } catch (err2) {
          if (cancelled) return
          if (isUnauthorized(err2)) {
            navigate('/login', { state: currentLoginState() })
          } else {
            setLoadError('일시적으로 결제 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate, retryTick])

  return (
    <section className="mypage-page">
      <div className="mypage-content">
        <div className="mypage-section">
          <div className="mypage-section-header">
            <h1 className="mypage-title">내 결제 내역</h1>
          </div>

          {isLoading && <p className="mypage-status">불러오는 중...</p>}

          {!isLoading && loadError && (
            <div className="mypage-status">
              <p className="mypage-error">{loadError}</p>
              <button type="button" className="mypage-ghost-btn" onClick={() => setRetryTick((t) => t + 1)}>
                다시 시도
              </button>
            </div>
          )}

          {!isLoading && payments && payments.length === 0 && (
            <p className="mypage-status">결제 내역이 없습니다.</p>
          )}

          {!isLoading && payments && payments.length > 0 && (
            <ul className="payment-list">
              {payments.map((payment) => {
                const statusKey = payment.status.toLowerCase()

                return (
                  <li className="payment-card" key={payment.paymentId}>
                    {/* 결제 상세는 목록에 이미 있는 데이터를 state로 함께 넘겨서, 상세 페이지가
                        재조회 없이 바로 렌더링할 수 있게 한다 (새로고침 등으로 state가 없을 때만 재조회). */}
                    <Link
                      to={`/mypage/payments/${payment.paymentId}`}
                      state={{ payment }}
                      className="payment-card-link"
                    >
                      <div className="payment-card-header">
                        <span className={`payment-status payment-status-${statusKey}`}>
                          {PAYMENT_STATUS_LABEL[statusKey] ?? payment.status}
                        </span>
                        <span className="reservation-id">예약번호 {payment.reservationId}</span>
                      </div>

                      <div className="payment-card-body">
                        <div className="payment-card-info">
                          <p className="payment-card-method">
                            {PAYMENT_METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod}
                          </p>
                          <p className="payment-card-meta">
                            {formatPaidAt(payment.paidAt)} · 승인번호 {payment.approvalNumber}
                          </p>
                        </div>
                        <span className="payment-card-amount">{payment.amount.toLocaleString()}원</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export default PaymentsPage
