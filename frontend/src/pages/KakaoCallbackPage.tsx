import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, kakaoLogin, takeKakaoLoginFrom } from '../api/gateway'
import { kakaoErrorMessage } from '../utils/kakaoLoginError'
import { loginRedirectPath } from '../utils/loginRedirect'
import './LoginPage.css'

// 카카오가 로그인 후 돌려보내는 화면 (/auth/kakao/callback?code=...&state=..., LDP-195).
// code·state를 서버에 보내 연결된 회원이면 바로 로그인, 처음 온 회원이면 추가 정보 입력 화면으로 보낸다.
function KakaoCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const kakaoError = searchParams.get('error')
  const [error, setError] = useState('')
  // code·state는 한 번만 쓸 수 있다 — 개발 모드(StrictMode)에서 effect가 두 번 실행돼도 요청은 한 번만 보낸다
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !code || !state) return
    started.current = true
    const from = takeKakaoLoginFrom()

    kakaoLogin({ code, state })
      .then((result) => {
        if (result.signupRequired) {
          navigate('/auth/kakao/signup', {
            replace: true,
            state: { signupToken: result.signupToken, email: result.email, name: result.name, from },
          })
          return
        }
        navigate(loginRedirectPath(from), { replace: true })
      })
      .catch((err: unknown) => {
        // 같은 이메일의 이메일 가입 회원 → 이메일 로그인 화면에서 안내 (계정을 자동으로 합치지 않음)
        if (err instanceof ApiError && err.code === 'SOCIAL_EMAIL_IN_USE') {
          navigate('/login', { replace: true, state: { from, message: kakaoErrorMessage(err) } })
          return
        }
        setError(kakaoErrorMessage(err))
      })
  }, [code, state, navigate])

  // 주소에 code가 없으면 요청하지 않고 바로 안내 — 동의 화면에서 취소하면 카카오가 code 대신 error를 붙여 돌려보낸다
  const message = error || (!code || !state ? (kakaoError ? '카카오 로그인을 취소했어요.' : '카카오 로그인 정보가 없어요. 다시 시도해 주세요.') : '')

  return (
    <section className="login-page">
      <div className="login-card">
        <h1 className="login-title">카카오 로그인</h1>
        {message ? (
          <>
            <p className="login-error">{message}</p>
            <p className="login-footer">
              <Link to="/login" replace>
                로그인 화면으로
              </Link>
            </p>
          </>
        ) : (
          <p className="login-description" role="status">
            로그인하는 중이에요...
          </p>
        )}
      </div>
    </section>
  )
}

export default KakaoCallbackPage
