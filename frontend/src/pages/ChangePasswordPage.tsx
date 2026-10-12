import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword, logout } from '../api/gateway'
import './MyPage.css'

// 사이드바에서 "비밀번호 변경"을 누르면 곧장 이 폼이 보인다 (예전처럼 버튼을 한 번 더 눌러야
// 폼이 펼쳐지는 중간 단계는 없앴다).
function ChangePasswordPage() {
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPasswordError('')

    // 서버 요청 전에 확인 가능한 것만 클라이언트에서 먼저 걸러낸다 (비밀번호 확인, 최소 길이).
    if (newPassword.length < 8) {
      setPasswordError('새 비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordError('새 비밀번호가 일치하지 않습니다.')
      return
    }

    setIsSubmitting(true)
    try {
      await changePassword({ currentPassword, newPassword })
      // 비밀번호 변경 시 서버가 모든 세션(리프레시 토큰)을 무효화하므로, 클라이언트도 함께 로그아웃하고
      // 새 비밀번호로 다시 로그인하도록 안내한다.
      await logout()
      navigate('/login', { state: { message: '비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요.' } })
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : '비밀번호 변경에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="mypage-page">
      <div className="mypage-content">
        <div className="mypage-section">
          <h1 className="mypage-title">비밀번호 변경</h1>

          <form className="mypage-form" onSubmit={handleSubmit} noValidate>
            <label className="mypage-field">
              <span>현재 비밀번호</span>
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>

            <label className="mypage-field">
              <span>새 비밀번호</span>
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </label>

            <label className="mypage-field">
              <span>새 비밀번호 확인</span>
              <input
                type="password"
                name="newPasswordConfirm"
                autoComplete="new-password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                required
              />
            </label>

            {passwordError && <p className="mypage-error">{passwordError}</p>}

            <p className="mypage-hint">비밀번호를 변경하면 자동으로 로그아웃되며, 새 비밀번호로 다시 로그인해야 합니다.</p>

            <div className="mypage-actions">
              <button
                type="button"
                className="mypage-ghost-btn"
                onClick={() => navigate('/mypage')}
                disabled={isSubmitting}
              >
                취소
              </button>
              <button type="submit" className="mypage-submit" disabled={isSubmitting}>
                {isSubmitting ? '변경 중...' : '비밀번호 변경'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

export default ChangePasswordPage
