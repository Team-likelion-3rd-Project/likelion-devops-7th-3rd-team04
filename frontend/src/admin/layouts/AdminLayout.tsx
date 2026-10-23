import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { adminLogout } from '../../api/gateway'
import { adminAuth } from '../../api/tokenStore'
import './AdminLayout.css'

const NAV_ITEMS = [
  { to: '/admin', label: '대시보드', end: true },
  { to: '/admin/users', label: '유저 관리', end: false },
  { to: '/admin/hotels', label: '호텔 관리', end: false },
  { to: '/admin/reservations', label: '예약 관리', end: false },
  { to: '/admin/room-assignments', label: '호실 배정', end: false },
]

// 고객 프론트(RootLayout: Header/Footer/MobileDock)와는 완전히 분리된 관리자 전용 레이아웃.
function AdminLayout() {
  const user = adminAuth.useUser()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await adminLogout()
    navigate('/admin/login')
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-title">Admin Console</div>
        <nav className="admin-nav" aria-label="관리자 메뉴">
          {NAV_ITEMS.map((item) => (
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
          <span className="admin-topbar-user">{user?.name ?? '관리자'}님</span>
          <button type="button" className="admin-logout-button" onClick={handleLogout}>
            로그아웃
          </button>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
