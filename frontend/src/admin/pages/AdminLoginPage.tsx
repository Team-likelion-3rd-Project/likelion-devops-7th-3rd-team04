import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { adminLogin } from '../../api/gateway'
import './AdminLoginPage.css'

interface LocationState {
  from?: { pathname: string }
}

// 고객용 LoginPage와 별개의 관리자 전용 로그인 화면. 백엔드도 /api/auth/admin/login으로
// 엔드포인트가 완전히 분리되어 있어(admins 테이블만 조회), 고객 계정으로는 애초에 로그인 자체가 실패한다.
function AdminLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      await adminLogin({ email, password })

      const state = location.state as LocationState | null
      const redirectTo = state?.from?.pathname ?? '/admin'
      navigate(redirectTo, { replace: true })
    } catch {
      setError('이메일 또는 비밀번호가 일치하지 않습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="admin-login-page">
      <div className="admin-login-card">
        <h1 className="admin-login-title">관리자 로그인</h1>
        <p className="admin-login-description">관리자 계정으로 로그인해주세요.</p>

        <form className="admin-login-form" onSubmit={handleSubmit} noValidate>
          <label className="admin-login-field">
            <span>이메일</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="admin-login-field">
            <span>비밀번호</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="admin-login-error">{error}</p>}

          <button type="submit" className="admin-login-submit" disabled={isLoading}>
            {isLoading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </section>
  )
}

export default AdminLoginPage
