import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, kakaoSignup } from '../api/gateway'
import { kakaoErrorMessage } from '../utils/kakaoLoginError'
import { loginRedirectPath } from '../utils/loginRedirect'
import './LoginPage.css'

// 콜백 화면이 넘기는 값 — 처음 온 카카오 회원의 가입 대기 토큰(10분)과 카카오 이메일·닉네임
interface KakaoSignupState {
  signupToken: string
  email: string
  name: string
  from?: string
}

// 처음 온 카카오 회원의 추가 정보 입력 (LDP-195). 이메일은 카카오 이메일을 그대로 쓰고, 이름·전화번호만 받는다.
// 여기서 나가도 서버에는 회원이 만들어지지 않는다 (가입 대기 토큰만 10분 뒤 사라짐).
function KakaoSignupPage() {
  const navigate = useNavigate()
  const signup = useLocation().state as KakaoSignupState | null
  const [name, setName] = useState(signup?.name ?? '')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!signup) return
    setError('')
    if (!name.trim()) {
      setError('이름을 입력해 주세요.')
      return
    }

    setIsLoading(true)
    try {
      await kakaoSignup({ signupToken: signup.signupToken, name: name.trim(), phoneNumber })
      navigate(loginRedirectPath(signup.from), { replace: true })
    } catch (err) {
      // 가입은 끝났고 로그인 토큰만 못 받음 — 카카오로 다시 로그인하면 바로 들어간다
      if (err instanceof ApiError && err.code === 'SIGNUP_COMPLETED_LOGIN_REQUIRED') {
        navigate('/login', {
          replace: true,
          state: { from: signup.from, message: '가입이 완료됐어요. 카카오로 다시 로그인해 주세요.' },
        })
        return
      }
      if (err instanceof ApiError && err.code === 'SIGNUP_FAILED') {
        setError('일시적인 오류로 가입하지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
      if (err instanceof ApiError && err.code?.startsWith('SOCIAL_')) {
        setExpired(err.code === 'SOCIAL_SIGNUP_EXPIRED')
        setError(kakaoErrorMessage(err))
        return
      }
      // 전화번호 형식 오류 등은 서버 문구 그대로
      setError(err instanceof Error ? err.message : '회원가입에 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!signup) {
    return (
      <section className="login-page">
        <div className="login-card">
          <h1 className="login-title">카카오 회원가입</h1>
          <p className="login-error">가입 정보가 없어요. 카카오 로그인부터 다시 진행해 주세요.</p>
          <p className="login-footer">
            <Link to="/login" replace>
              로그인 화면으로
            </Link>
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="login-page">
      <div className="login-card">
        <h1 className="login-title">카카오 회원가입</h1>
        <p className="login-description">예약 연락을 위해 이름과 전화번호를 입력해 주세요.</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="login-field">
            <span>이메일 (카카오 계정)</span>
            <input type="email" name="email" value={signup.email} readOnly />
          </label>

          <label className="login-field">
            <span>이름</span>
            <input
              type="text"
              name="name"
              autoComplete="name"
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="login-field">
            <span>전화번호</span>
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

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-submit" disabled={isLoading || expired}>
            {isLoading ? '가입 중...' : '가입 완료'}
          </button>
        </form>

        {expired && (
          <p className="login-footer">
            <Link to="/login" replace state={signup.from ? { from: signup.from } : undefined}>
              카카오 로그인 다시 하기
            </Link>
          </p>
        )}
      </div>
    </section>
  )
}

export default KakaoSignupPage
