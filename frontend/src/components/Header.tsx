import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { HOTELS } from '../data/hotels'
import { logout } from '../api/gateway'
import { customerAuth } from '../api/tokenStore'
import './Header.css'

const PHILOSOPHY_ITEMS = [
  { slug: 'architecture', label: '건축' },
  { slug: 'design', label: '디자인' },
  { slug: 'nature', label: '자연' },
  { slug: 'eco', label: '에코' },
]

type MenuKey = 'philosophy' | 'hotels' | 'profile' | null

function Header() {
  const [openMenu, setOpenMenu] = useState<MenuKey>(null)
  const accessToken = customerAuth.useAccessToken()
  const user = customerAuth.useUser()
  const navigate = useNavigate()

  const closeMenu = () => setOpenMenu(null)

  const handleLogout = async () => {
    closeMenu()
    await logout()
    navigate('/')
  }

  return (
    <header className="site-header">
      {/* TODO: 확정된 브랜드 로고/명칭으로 교체 */}
      <Link to="/" className="site-logo" onClick={closeMenu}>
        LOGO
      </Link>

      <nav className="site-nav" aria-label="주요 메뉴">
        <div
          className="nav-item"
          onMouseEnter={() => setOpenMenu('philosophy')}
          onMouseLeave={closeMenu}
        >
          <button
            type="button"
            className="nav-trigger"
            aria-expanded={openMenu === 'philosophy'}
            onFocus={() => setOpenMenu('philosophy')}
            onClick={() => setOpenMenu((prev) => (prev === 'philosophy' ? null : 'philosophy'))}
          >
            브랜드 가치
          </button>
          {openMenu === 'philosophy' && (
            <ul className="nav-dropdown">
              {PHILOSOPHY_ITEMS.map((item) => (
                <li key={item.slug}>
                  <NavLink to={`/philosophy/${item.slug}`} onClick={closeMenu}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="nav-item"
          onMouseEnter={() => setOpenMenu('hotels')}
          onMouseLeave={closeMenu}
        >
          <button
            type="button"
            className="nav-trigger"
            aria-expanded={openMenu === 'hotels'}
            onFocus={() => setOpenMenu('hotels')}
            onClick={() => setOpenMenu((prev) => (prev === 'hotels' ? null : 'hotels'))}
          >
            호텔
          </button>
          {openMenu === 'hotels' && (
            <ul className="nav-dropdown">
              {HOTELS.map((hotel) => (
                <li key={hotel.id}>
                  <NavLink to={`/hotels/${hotel.id}`} onClick={closeMenu}>
                    {hotel.name}
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="nav-item">
          <NavLink to="/notices" className="nav-trigger" onClick={closeMenu}>
            공지사항
          </NavLink>
        </div>
      </nav>

      <div className="header-actions">
        <Link to={accessToken ? '/reservation' : '/login'} className="nav-cta">
          예약하기
        </Link>
        {accessToken && user ? (
          <div
            className="nav-item profile-item"
            onMouseEnter={() => setOpenMenu('profile')}
            onMouseLeave={closeMenu}
          >
            <button
              type="button"
              className="profile-trigger"
              aria-expanded={openMenu === 'profile'}
              onFocus={() => setOpenMenu('profile')}
              onClick={() => setOpenMenu((prev) => (prev === 'profile' ? null : 'profile'))}
            >
              <span className="profile-avatar" aria-hidden="true">
                {user.name.charAt(0)}
              </span>
              <span className="profile-name">{user.name} 님</span>
              <span className="profile-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {openMenu === 'profile' && (
              <ul className="nav-dropdown profile-dropdown">
                <li>
                  <NavLink to="/mypage" onClick={closeMenu}>
                    마이페이지
                  </NavLink>
                </li>
                <li>
                  <button type="button" className="profile-logout" onClick={handleLogout}>
                    로그아웃
                  </button>
                </li>
              </ul>
            )}
          </div>
        ) : (
          <Link to="/login" className="nav-login">
            로그인
          </Link>
        )}
      </div>
    </header>
  )
}

export default Header
