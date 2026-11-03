import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { fetchAdminHotels } from '../../api/adminApi'
import { adminLogout } from '../../api/gateway'
import { adminAuth } from '../../api/tokenStore'
import { ADMIN_ROLE_LABEL, canAccessArea, useAdminScope } from '../adminScope'
import type { AdminArea } from '../adminScope'
import ErrorBoundary from '../../components/ErrorBoundary'
import { AdminErrorFallback } from '../components/AdminStatusCard'
import './AdminLayout.css'

// area가 있는 메뉴는 직급별로 숨긴다 (LDP-184, adminScope.ts)
const NAV_ITEMS: { to: string; label: string; end: boolean; area?: AdminArea }[] = [
  { to: '/admin', label: '대시보드', end: true },
  { to: '/admin/users', label: '유저 관리', end: false, area: 'users' },
  { to: '/admin/hotels', label: '호텔 관리', end: false, area: 'hotels' },
  { to: '/admin/reservations', label: '예약 관리', end: false },
  { to: '/admin/room-assignments', label: '호실 배정', end: false },
  { to: '/admin/notices', label: '공지 관리', end: false, area: 'notices' },
]

// 고객 프론트(RootLayout: Header/Footer/MobileDock)와는 완전히 분리된 관리자 전용 레이아웃.
function AdminLayout() {
  const user = adminAuth.useUser()
  const scope = useAdminScope()
  const navigate = useNavigate()
  const location = useLocation()
  const [branchName, setBranchName] = useState('')

  // 지점 계정은 상단에 "서울점 · 지점 관리자"처럼 소속을 보여준다
  useEffect(() => {
    if (scope.hotelId === null) return
    let ignore = false
    fetchAdminHotels()
      .then((hotels) => {
        const name = hotels.find((h) => h.hotelId === scope.hotelId)?.name
        if (!ignore && name) setBranchName(name)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [scope.hotelId])

  const roleLabel = ADMIN_ROLE_LABEL[scope.role]
  const scopeLabel = scope.hotelId === null ? roleLabel : `${branchName || `지점 ${scope.hotelId}`} · ${roleLabel}`

  const handleLogout = async () => {
    await adminLogout()
    navigate('/admin/login')
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-title">Admin Console</div>
        <nav className="admin-nav" aria-label="관리자 메뉴">
          {NAV_ITEMS.filter((item) => !item.area || canAccessArea(scope, item.area)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-nav-item${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <span className="admin-topbar-scope">{scopeLabel}</span>
          <span className="admin-topbar-user">{user?.name ?? '관리자'}님</span>
          <button type="button" className="admin-logout-button" onClick={handleLogout}>
            로그아웃
          </button>
        </header>

        <main className="admin-content">
          {/* 화면 오류는 본문만 안내로 바꾸고 메뉴는 남긴다 — 다른 메뉴로 이동하면 풀린다 (LDP-158) */}
          <ErrorBoundary resetKey={location.pathname} fallback={<AdminErrorFallback />}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
