import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { register } from '../api/gateway'
import { loginRedirectPath, type LoginLocationState } from '../utils/loginRedirect'
import './SignupPage.css'

function SignupPage() {
  const navigate = useNavigate()
  // 로그인 화면에서 넘어온 경우, 가입 후에도 원래 보던 화면으로 돌려보낸다.
  const from = (useLocation().state as LoginLocationState | null)?.from
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [name, setName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')

    // 서버 요청 전에 확인 가능한 것만 클라이언트에서 먼저 걸러낸다 (비밀번호 확인, 최소 길이).
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }

    setIsLoading(true)
    try {
      // register()가 회원가입과 동시에 로그인을 처리하고 액세스 토큰을 메모리(tokenStore)에 저장한다.
      // 리프레시 토큰은 서버가 httpOnly 쿠키로 내려주므로 JS에서는 다루지 않는다.
      await register({ email, password, name, phoneNumber })
      navigate(loginRedirectPath(from), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '회원가입에 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="signup-page">
      <div className="signup-card">
        <h1 className="signup-title">회원가입</h1>
        <p className="signup-description">몇 가지 정보만 입력하면 가입이 완료됩니다.</p>

        <form className="signup-form" onSubmit={handleSubmit} noValidate>
          <label className="signup-field">
            <span>이름</span>
            <input
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="signup-field">
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

          <label className="signup-field">
            <span>휴대폰 번호</span>
            <input
              type="tel"
              name="phoneNumber"
              autoComplete="tel"
              placeholder="010-1234-5678"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              required
            />
          </label>

          <label className="signup-field">
            <span>비밀번호</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <label className="signup-field">
            <span>비밀번호 확인</span>
            <input
              type="password"
              name="passwordConfirm"
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
            />
          </label>

          {error && <p className="signup-error">{error}</p>}

          <button type="submit" className="signup-submit" disabled={isLoading}>
            {isLoading ? '가입 중...' : '회원가입'}
          </button>
        </form>

        <p className="signup-footer">
          이미 계정이 있으신가요? <Link to="/login" state={from ? { from } : undefined}>
            로그인
          </Link>
        </p>
      </div>
    </section>
  )
}

export default SignupPage
