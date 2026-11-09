import { Link } from 'react-router-dom'
import { fetchMyPaymentsPage, type Payment } from '../api/payments'
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, formatPaidAt } from '../utils/payment'
import { useMyPagedList } from '../utils/useMyPagedList'
import './MyPage.css'
import './PaymentsPage.css'

const LOAD_ERROR = '일시적으로 결제 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
const paymentKey = (payment: Payment) => payment.paymentId

// 마이페이지 > 결제 내역(/mypage/payments). 내가 결제했던 내역을 최신순으로 보여주고, 클릭하면
// 결제 상세 페이지(PaymentDetailPage, /mypage/payments/:paymentId)로 이동한다.
function PaymentsPage() {
  // 한 페이지(20건)씩 불러오고 "더 보기"로 이어 붙인다 (부하 테스트 11-06 — 전체를 한 번에 받지 않는다)
  const {
    items: payments,
    hasMore,
    isLoading,
    loadError,
    retry,
    loadMore,
    isLoadingMore,
    loadMoreError,
  } = useMyPagedList(fetchMyPaymentsPage, paymentKey, LOAD_ERROR)

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
              <button type="button" className="mypage-ghost-btn" onClick={retry}>
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

          {!isLoading && hasMore && (
            <div className="mypage-status">
              {loadMoreError && <p className="mypage-error">{loadMoreError}</p>}
              <button type="button" className="mypage-ghost-btn" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? '불러오는 중...' : '더 보기'}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default PaymentsPage
