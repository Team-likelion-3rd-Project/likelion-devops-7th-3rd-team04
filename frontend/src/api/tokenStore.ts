import { useSyncExternalStore } from 'react'

// 액세스 토큰을 localStorage/sessionStorage가 아닌 메모리(모듈 스코프 변수)에만 보관합니다.
// XSS가 발생해도 스토리지를 뒤져서 토큰을 훔쳐갈 수 없고, 탭을 새로고침하면 사라집니다
// (그래서 앱 부팅 시 refreshToken 쿠키로 /api/auth/refresh를 호출해 재발급받아야 합니다).

export interface UserInfo {
  userId: number
  email: string
  name: string
  role: string
}

export interface AuthStore {
  getAccessToken(): string | null
  getUser(): UserInfo | null
  setAuth(token: string, nextUser: UserInfo): void
  setUser(nextUser: UserInfo): void
  clearAccessToken(): void
  useAccessToken(): string | null
  useUser(): UserInfo | null
}

// 고객/관리자가 각자의 accessToken·user를 독립적으로 갖도록 스토어를 팩토리로 만듭니다.
// 관리자와 고객은 백엔드에서부터 쿠키(refreshToken vs adminRefreshToken)가 분리되어 있으므로,
// 프론트도 하나의 전역 변수를 공유하면 안 됩니다 — 공유하면 관리자로 로그인한 상태에서 고객
// 페이지로 이동했을 때 고객 화면이 관리자 세션을 "로그인된 사용자"로 오인하는 문제가 생깁니다.
function createAuthStore(): AuthStore {
  let accessToken: string | null = null
  let user: UserInfo | null = null

  // 토큰/유저 정보가 바뀔 때 리렌더링이 필요한 컴포넌트(예: 헤더의 프로필 메뉴)를 위한 구독자 목록
  const listeners = new Set<() => void>()

  function getAccessToken(): string | null {
    return accessToken
  }

  function getUser(): UserInfo | null {
    return user
  }

  function notify(): void {
    listeners.forEach((listener) => listener())
  }

  // 로그인/토큰 재발급 성공 시 액세스 토큰과 유저 정보를 함께 갱신한다.
  function setAuth(token: string, nextUser: UserInfo): void {
    accessToken = token
    user = nextUser
    notify()
  }

  // 내 정보 수정 성공 시, 토큰은 그대로 두고 유저 정보(이름/전화번호 등)만 갱신할 때 사용
  function setUser(nextUser: UserInfo): void {
    user = nextUser
    notify()
  }

  function clearAccessToken(): void {
    accessToken = null
    user = null
    notify()
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  // 컴포넌트에서 로그인 여부(액세스 토큰 유무)에 따라 리렌더링하고 싶을 때 사용
  function useAccessToken(): string | null {
    return useSyncExternalStore(subscribe, getAccessToken)
  }

  // 컴포넌트에서 로그인한 유저 정보(이름 등)가 필요할 때 사용
  function useUser(): UserInfo | null {
    return useSyncExternalStore(subscribe, getUser)
  }

  return { getAccessToken, getUser, setAuth, setUser, clearAccessToken, useAccessToken, useUser }
}

// 고객 화면(Header, MyPage, LoginPage 등)이 사용하는 스토어
export const customerAuth = createAuthStore()

// 관리자 화면(/admin/*)이 사용하는 별도 스토어. customerAuth와 완전히 독립적이라
// 관리자 로그인/로그아웃이 고객 세션에 영향을 주지 않고, 그 반대도 마찬가지입니다.
export const adminAuth = createAuthStore()
