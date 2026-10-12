import { NavLink } from 'react-router-dom'
import './MobileDock.css'

const DOCK_ITEMS = [
  { to: '/', label: '홈', icon: '🏠', end: true },
  { to: '/reservation', label: '예약', icon: '📅', end: false },
  { to: '/mypage', label: '마이페이지', icon: '👤', end: false },
]

function MobileDock() {
  return (
    <nav className="mobile-dock" aria-label="모바일 빠른 메뉴">
      {DOCK_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `mobile-dock-item${isActive ? ' active' : ''}`}
        >
          <span className="mobile-dock-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="mobile-dock-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export default MobileDock
