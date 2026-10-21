import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { withdrawMe } from '../api/gateway'
import './MyPage.css'

function WithdrawPage() {
  const navigate = useNavigate()

  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const startWithdrawing = () => {
    setWithdrawError('')
    setIsWithdrawing(true)
  }

  const cancelWithdrawing = () => {
    setIsWithdrawing(false)
    setWithdrawError('')
  }

  const handleWithdraw = async () => {
    setWithdrawError('')
    setIsSubmitting(true)
    try {
      await withdrawMe()
      navigate('/login', { state: { message: '회원 탈퇴가 완료되었습니다. 그동안 이용해주셔서 감사합니다.' } })
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : '회원 탈퇴에 실패했습니다.')
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
                {isSubmitting ? '탈퇴 처리 중...' : '탈퇴하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default WithdrawPage
