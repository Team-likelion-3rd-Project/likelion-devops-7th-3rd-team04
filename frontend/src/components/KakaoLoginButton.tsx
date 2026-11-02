import { useState } from 'react'
import { startKakaoLogin } from '../api/gateway'
import { kakaoErrorMessage } from '../utils/kakaoLoginError'
import './KakaoLoginButton.css'

// 로그인·회원가입 화면의 "카카오로 시작하기" (LDP-195). 처음 온 회원도 이 버튼 하나로 가입까지 이어진다.
// from = 로그인 후 돌아갈 화면 (이메일 로그인과 같은 규칙)
function KakaoLoginButton({ from }: { from?: string }) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleClick = async () => {
    setIsLoading(true)
    setError('')
    try {
      // 성공하면 카카오 화면으로 페이지가 넘어가므로 로딩 상태를 풀지 않는다
      await startKakaoLogin(from)
    } catch (err) {
      setError(kakaoErrorMessage(err))
      setIsLoading(false)
    }
  }

  return (
    <div className="kakao-login">
      <div className="kakao-login-divider">
        <span>또는</span>
      </div>
      <button type="button" className="kakao-login-button" onClick={handleClick} disabled={isLoading}>
        <svg className="kakao-login-symbol" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3C6.48 3 2 6.58 2 11c0 2.86 1.88 5.37 4.71 6.79l-.96 3.53c-.08.31.27.56.54.38l4.21-2.79c.49.06.99.09 1.5.09 5.52 0 10-3.58 10-8S17.52 3 12 3z" />
        </svg>
        {isLoading ? '카카오로 이동 중...' : '카카오로 시작하기'}
      </button>
      {error && <p className="kakao-login-error">{error}</p>}
    </div>
  )
}

export default KakaoLoginButton
