import type { CSSProperties } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { HotelOutletContext } from '../layouts/HotelLayout'
import './HotelDetailPage.css'

/**
 * CSS 커스텀 프로퍼티를 인라인 style로 내려준다. 값이 없으면(사진 미제공) 아무것도 설정하지
 * 않아 CSS의 `var(--x, none)` 폴백(패턴+accent 그라디언트)이 그대로 적용되게 한다.
 */
function photoVar(name: string, src: string | undefined): CSSProperties {
  return src ? ({ [name]: `url(${src})` } as CSSProperties) : {}
}

/**
 * `/hotels/:hotelId`의 index 콘텐츠. 존재하지 않는 hotelId 처리는 HotelLayout에서 이미
 * 끝났으므로, 여기서는 확인된 hotel을 받아 히어로 섹션 + STAY/WATERS 진입 타일만 그린다.
 */
function HotelDetailPage() {
  const { hotel } = useOutletContext<HotelOutletContext>()

  return (
    <>
      {/* MainPage의 .hero처럼 폭 제약 없이 렌더되어 화면 가로축을 그대로 채운다.
          사진이 준비된 호텔은 실사진을, 아직 없는 호텔은 accent 그라디언트를 보여준다. */}
      <div
        className="hotel-detail-hero"
        style={
          {
            '--hotel-accent': hotel.accent,
            ...photoVar('--hotel-photo', hotel.images.hero),
          } as CSSProperties
        }
        aria-hidden="true"
      />
      <div className="hotel-detail-body">
        <p className="hotel-detail-location">{hotel.location}</p>
        <h1 className="hotel-detail-name">{hotel.name}</h1>
        <p className="hotel-detail-summary">{hotel.summary}</p>

        <div className="hotel-detail-features">
          <Link to={`/hotels/${hotel.id}/stay`} className="hotel-detail-feature">
            <div
              className="hotel-detail-feature-image stay"
              style={photoVar('--tile-photo', hotel.images.stay)}
              aria-hidden="true"
            />
            <div className="hotel-detail-feature-overlay">
              <span className="hotel-detail-feature-label">STAY</span>
              <span className="hotel-detail-feature-caption">객실 안내 보기</span>
            </div>
          </Link>
          <Link to={`/hotels/${hotel.id}/waters`} className="hotel-detail-feature">
            <div
              className="hotel-detail-feature-image waters"
              style={photoVar('--tile-photo', hotel.images.waters)}
              aria-hidden="true"
            />
            <div className="hotel-detail-feature-overlay">
              <span className="hotel-detail-feature-label">WATERS</span>
              <span className="hotel-detail-feature-caption">수영장 안내 보기</span>
            </div>
          </Link>
        </div>
      </div>
    </>
  )
}

export default HotelDetailPage
