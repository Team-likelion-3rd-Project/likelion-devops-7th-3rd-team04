import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import BrandLogo from './BrandLogo'
import { useHotels } from '../data/hotelStore'
import { logout } from '../api/gateway'
import { customerAuth } from '../api/tokenStore'
import { loginStateFrom } from '../utils/loginRedirect'
import './Header.css'

const PHILOSOPHY_ITEMS = [
  { slug: 'architecture', label: '건축' },
  { slug: 'design', label: '디자인' },
  { slug: 'nature', label: '자연' },
  { slug: 'eco', label: '에코' },
]

type MenuKey = 'philosophy' | 'hotels' | 'profile' | null

function Header() {
  // 호텔 이름·소개는 API(GET /api/hotels) 응답으로 갱신된다 (data/hotelStore.ts)
  const hotels = useHotels()
  const [openMenu, setOpenMenu] = useState<MenuKey>(null)
  const accessToken = customerAuth.useAccessToken()
  const location = useLocation()
  const user = customerAuth.useUser()
  const navigate = useNavigate()

  const closeMenu = () => setOpenMenu(null)

  const handleLogout = async () => {
    closeMenu()
    await logout()
    // 로그아웃이 너무 빨라 티가 안 나서, 메인으로 가며 안내 문구와 화면 전환 효과를 보여 준다 (RootLayout)
    window.scrollTo({ top: 0 })
    navigate('/', { state: { notice: '로그아웃되었습니다.' } })
  }

  return (
    <header className="site-header">
      <Link to="/" className="site-logo" onClick={closeMenu} aria-label="머묾 홈">
        <BrandLogo />
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
              {hotels.map((hotel) => (
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
        {/* 비로그인이면 로그인 화면을 거쳐 예약 화면으로 오도록 from을 넘긴다. */}
        <Link
          to={accessToken ? '/reservation' : '/login'}
          state={accessToken ? undefined : loginStateFrom('/reservation')}
          className="nav-cta"
        >
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
          <Link to="/login" state={loginStateFrom(`${location.pathname}${location.search}`)} className="nav-login">
            로그인
          </Link>
        )}
      </div>
    </header>
  )
}

export default Header
