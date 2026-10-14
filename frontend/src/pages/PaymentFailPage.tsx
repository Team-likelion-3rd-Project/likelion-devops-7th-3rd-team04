import { Link, useSearchParams } from 'react-router-dom'
import './PaymentResultPage.css'

/** 결제 실패 URL(/reservation/payment/fail). 토스 결제창에서 사용자가 취소했거나 결제가 실패하면
 * 토스가 code·message를 붙여 이 주소로 돌려보낸다. 서버 승인 전 단계라 예약은 결제 대기 상태 그대로다. */
function PaymentFailPage() {
  const [searchParams] = useSearchParams()
  const reservationId = Number(searchParams.get('reservationId'))
  const code = searchParams.get('code')
  const message = searchParams.get('message')

  // 사용자가 결제창을 직접 닫은 경우는 실패가 아니라 취소로 안내한다.
  const isCanceled = code === 'PAY_PROCESS_CANCELED'

  return (
    <section className="payment-result-page">
      <div className="payment-result-card">
        <span className="payment-result-icon is-fail" aria-hidden="true">
          !
        </span>
        <h1>{isCanceled ? '결제를 취소했습니다' : '결제에 실패했습니다'}</h1>
        <p>{isCanceled ? '결제가 진행되지 않았습니다.' : message || '결제가 완료되지 않았습니다.'}</p>
        <p>예약은 결제 대기 상태로 남아 있으며, 결제 기한 안에 다시 결제할 수 있습니다.</p>
        <div className="payment-result-actions">
          <Link to="/mypage/payments/pending" className="payment-result-secondary">
            결제 대기 목록
          </Link>
          {reservationId > 0 && (
            <Link to={`/mypage/reservations/${reservationId}`} className="payment-result-primary">
              다시 결제하기
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

export default PaymentFailPage
