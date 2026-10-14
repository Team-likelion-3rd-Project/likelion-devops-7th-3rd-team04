import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { HOTELS } from '../data/hotels'
import HotelCard from '../components/HotelCard'
import { customerAuth } from '../api/tokenStore'
import { loginStateFrom } from '../utils/loginRedirect'
import './MainPage.css'

// 메인 배경 사진은 서울점 대표 사진을 쓴다. 사진이 없으면 CSS의 그라디언트만 보인다.
const heroPhoto = HOTELS[0]?.images.hero
const heroStyle = heroPhoto ? ({ '--main-hero-photo': `url(${heroPhoto})` } as CSSProperties) : undefined

function MainPage() {
  const accessToken = customerAuth.useAccessToken()

  return (
    <>
      <section className="hero" style={heroStyle}>
        <div className="hero-content">
          <p className="hero-eyebrow">A Brand for value of time</p>
          <h1 className="hero-title">머무는 순간, 온전히 나를 위한 시간</h1>
          <p className="hero-description">
            도심과 자연 속 세 곳의 호텔에서, 조용하고 세심하게 준비된 휴식을 경험하세요.
          </p>
          <Link
            to={accessToken ? '/reservation' : '/login'}
            state={accessToken ? undefined : loginStateFrom('/reservation')}
            className="hero-cta"
          >
            예약하기
          </Link>
        </div>
      </section>

      <section className="hotel-intro">
        <div className="hotel-intro-header">
          <h2>호텔 소개</h2>
          <Link to="/hotels" className="hotel-intro-link">
            전체 호텔 보기 →
          </Link>
        </div>
        <div className="hotel-intro-grid">
          {HOTELS.map((hotel) => (
            <HotelCard key={hotel.id} hotel={hotel} />
          ))}
        </div>
      </section>
    </>
  )
}

export default MainPage
