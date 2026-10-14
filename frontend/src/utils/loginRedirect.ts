// 로그인 화면으로 보낼 때 "원래 보던 화면"을 함께 넘기고, 로그인(회원가입) 후 그 화면으로 돌려보내는 헬퍼.
// 관리자 화면의 AdminGuard -> AdminLoginPage(state.from)와 같은 방식이다.

// 로그인 화면이 받는 location.state. message는 비밀번호 변경·탈퇴 등 다른 화면이 넘기는 안내 문구.
export interface LoginLocationState {
  from?: string
  message?: string
}

// 로그인 화면으로 이동할 때 넘길 state. path는 pathname + search(예약 조건 쿼리 등)까지 포함한다.
export function loginStateFrom(path: string, message?: string): LoginLocationState {
  return message ? { from: path, message } : { from: path }
}

// 지금 보고 있는 화면을 기준으로 state를 만든다. useEffect 안의 navigate('/login')에서 쓰기 좋도록
// 훅(useLocation) 대신 호출 시점의 주소를 읽는다.
export function currentLoginState(message?: string): LoginLocationState {
  return loginStateFrom(`${window.location.pathname}${window.location.search}`, message)
}

// 로그인 후 이동할 주소. 우리 사이트 안의 경로만 허용하고, 로그인·회원가입 화면으로 되돌아가는 경우는 홈으로 보낸다.
export function loginRedirectPath(from?: string): string {
  if (!from || !from.startsWith('/') || from.startsWith('//')) return '/'
  if (from.startsWith('/login') || from.startsWith('/signup')) return '/'
  return from
}
