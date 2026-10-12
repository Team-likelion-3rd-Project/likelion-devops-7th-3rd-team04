import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { login } from '../api/gateway'
import './LoginPage.css'

interface LoginLocationState {
  message?: string
}

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // 비밀번호 변경 후 로그아웃 -> 재로그인 유도처럼, 다른 페이지에서 안내 메시지를 들고 넘어올 수 있다.
  const infoMessage = (location.state as LoginLocationState | null)?.message
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      // login()이 응답의 액세스 토큰을 메모리(tokenStore)에 저장한다.
      // 리프레시 토큰은 서버가 httpOnly 쿠키로 내려주므로 JS에서는 다루지 않는다.
      await login({ email, password })
      navigate('/')
    } catch {
      // 서버가 내려주는 구체적인 실패 사유(비밀번호 형식 오류/이메일 불일치 등)를 그대로 노출하지 않고
      // 하나의 문구로 통일한다 (계정 존재 여부·비밀번호 정책을 추측할 수 있는 단서를 주지 않기 위함).
      setError('이메일 또는 비밀번호가 일치하지 않습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="login-page">
      <div className="login-card">
        <h1 className="login-title">로그인</h1>
        <p className="login-description">다시 오신 것을 환영합니다. 계정 정보를 입력해주세요.</p>

        {infoMessage && <p className="login-info">{infoMessage}</p>}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="login-field">
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

          <label className="login-field">
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

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-submit" disabled={isLoading}>
            {isLoading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="login-footer">
          계정이 없으신가요? <Link to="/signup">회원가입</Link>
        </p>
      </div>
    </section>
  )
}

export default LoginPage
