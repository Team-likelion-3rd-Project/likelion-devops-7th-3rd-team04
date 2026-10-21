import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, withdrawMe } from '../api/gateway'
import './MyPage.css'

// 탈퇴 실패 코드별 안내 (#211·#214). 실패하면 계정·로그인 상태는 그대로라 같은 버튼으로 다시 시도할 수 있다.
const WITHDRAW_ERROR_MESSAGE: Record<string, string> = {
  HAS_UPCOMING_RESERVATIONS: '이용 예정인 예약이 있어 탈퇴할 수 없어요. 결제 대기·예약 확정 예약을 먼저 취소해 주세요.',
  BOOKING_SERVICE_UNAVAILABLE: '예약 정보를 확인하지 못해 탈퇴를 멈췄어요. 계정은 그대로이니 잠시 후 다시 시도해 주세요.',
  WITHDRAW_INCOMPLETE: '탈퇴 처리가 중간에 멈췄어요. 아래 버튼으로 다시 시도하면 남은 단계부터 마무리돼요.',
}

function WithdrawPage() {
  const navigate = useNavigate()

  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const startWithdrawing = () => {
    setWithdrawError('')
    setErrorCode(undefined)
    setIsWithdrawing(true)
  }

  const cancelWithdrawing = () => {
    setIsWithdrawing(false)
    setWithdrawError('')
    setErrorCode(undefined)
  }

  const handleWithdraw = async () => {
    setWithdrawError('')
    setIsSubmitting(true)
    try {
      // 성공했을 때만 로그인 상태를 지운다(withdrawMe). WITHDRAW_INCOMPLETE처럼 중간에 멈춘 경우 토큰이 있어야
      // 같은 요청으로 이어서 처리할 수 있다 — 이미 탈퇴가 끝났으면 서버가 200으로 응답한다.
      await withdrawMe()
      navigate('/login', { state: { message: '회원 탈퇴가 완료되었습니다. 그동안 이용해주셔서 감사합니다.' } })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      setErrorCode(code)
      setWithdrawError(
        (code && WITHDRAW_ERROR_MESSAGE[code]) || (err instanceof Error ? err.message : '회원 탈퇴에 실패했습니다.'),
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="mypage-page">
      <div className="mypage-content">
        <div className="mypage-section">
          <div className="mypage-section-header">
            <h1 className="mypage-title">회원 탈퇴</h1>
          </div>
          <p className="mypage-hint">계정을 삭제하면 되돌릴 수 없습니다.</p>
          <div className="mypage-actions">
            <button type="button" className="mypage-danger-btn" onClick={startWithdrawing}>
              회원 탈퇴
            </button>
          </div>
        </div>
      </div>

      {isWithdrawing && (
        <div className="mypage-modal-overlay" onClick={cancelWithdrawing}>
          <div
            className="mypage-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="withdraw-modal-title">정말 탈퇴하시겠어요?</h2>
            <p className="mypage-warning">
              탈퇴 시 계정 정보가 즉시 삭제되며 되돌릴 수 없습니다. 그동안의 예약 내역 등도 더 이상 조회할 수 없습니다.
            </p>

            {withdrawError && <p className="mypage-error">{withdrawError}</p>}
            {errorCode === 'HAS_UPCOMING_RESERVATIONS' && (
              <p className="mypage-hint">
                <Link to="/mypage/reservations">내 예약 보기 →</Link>
              </p>
            )}

            <div className="mypage-actions">
              <button
                type="button"
                className="mypage-ghost-btn"
                onClick={cancelWithdrawing}
                disabled={isSubmitting}
              >
                취소
              </button>
              <button type="button" className="mypage-danger-btn" onClick={handleWithdraw} disabled={isSubmitting}>
                {isSubmitting ? '탈퇴 처리 중...' : errorCode === 'WITHDRAW_INCOMPLETE' ? '탈퇴 다시 시도' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default WithdrawPage
