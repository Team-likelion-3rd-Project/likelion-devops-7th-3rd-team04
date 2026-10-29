import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { refreshAdminAccessToken } from '../api/gateway'
import { adminAuth } from '../api/tokenStore'
import { adminErrorMessage, canAccessArea, canAccessHotel, useAdminScope } from './adminScope'
import type { AdminArea } from './adminScope'
import { AdminForbidden } from './components/AdminStatusCard'

// 관리자 라우트 전용 클라이언트 라우트가드 (UX용). 실제 접근 제어는 서버의
// RolesGuard(@Roles('ADMIN'))가 담당하며, 이 가드는 권한 없는 사용자가 관리자 화면을
// 잠깐이라도 보지 않도록 UI 레벨에서 미리 걸러주는 역할만 한다.
function AdminGuard() {
  const accessToken = adminAuth.useAccessToken()
  const user = adminAuth.useUser()
  const location = useLocation()
  // 마운트 시점에 이미 액세스 토큰이 있으면 재발급을 시도할 필요가 없다.
  const [checked, setChecked] = useState(() => Boolean(adminAuth.getAccessToken()))

  useEffect(() => {
    if (checked) return

    let cancelled = false
    // 새로고침 등으로 /admin/* 경로에 직접 진입하면 메모리의 액세스 토큰이 비어있을 수 있다.
    // httpOnly adminRefreshToken 쿠키가 남아있다면 조용히 재발급받아 관리자 세션을 복구해본다.
    refreshAdminAccessToken()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecked(true)
      })

    return () => {
      cancelled = true
    }
  }, [checked])

  if (!checked) {
    return <div className="admin-guard-checking">확인 중...</div>
  }

  if (!accessToken || user?.role !== 'ADMIN') {
    return <Navigate to="/admin/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

// 직급별 메뉴 라우트가드 (LDP-184). 메뉴에서 숨긴 화면에 주소로 들어오면 안내 카드를 보여준다.
// 경로에 :hotelId가 있으면 소속 지점인지도 확인한다 — 실제 차단은 서버가 한다.
export function AdminAreaRoute({ area }: { area?: AdminArea }) {
  const scope = useAdminScope()
  const { hotelId } = useParams()

  if (area && !canAccessArea(scope, area)) {
    return <AdminForbidden message={adminErrorMessage('ADMIN_ROLE_FORBIDDEN', '')} />
  }
  if (hotelId && !canAccessHotel(scope, Number(hotelId))) {
    return <AdminForbidden message={adminErrorMessage('ADMIN_HOTEL_FORBIDDEN', '')} />
  }
  return <Outlet />
}

export default AdminGuard
