import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { preload } from 'react-dom'
import { Link } from 'react-router-dom'
import { HOTELS } from '../data/hotels'
import { BRAND_VALUES } from '../data/brandValues'
import { fetchNotices, formatNoticeDate, NOTICE_CATEGORY_LABEL, noticeBranchName } from '../api/notices'
import type { Notice } from '../api/notices'
import { useHotels } from '../data/hotelStore'
import HotelCard from '../components/HotelCard'
import { customerAuth } from '../api/tokenStore'
import { loginStateFrom } from '../utils/loginRedirect'
import './MainPage.css'

// 메인 배경 사진: 지점별 대표 사진과 수영장 사진을 번갈아 3초마다 바꾼다. 사진이 없으면 CSS의 그라디언트만 보인다.
const HERO_PHOTOS = HOTELS.flatMap((hotel) => [hotel.images.hero, hotel.images.waters]).filter(
  (photo): photo is string => Boolean(photo),
)
const HERO_INTERVAL_MS = 3000


// 움직임 줄이기 설정을 켠 사용자에게는 첫 사진만 보여 준다
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function MainPage() {
  const hotels = useHotels()
  const accessToken = customerAuth.useAccessToken()
  const [heroIndex, setHeroIndex] = useState(0)
  // 사진을 불러 둔 슬라이드 수 — 처음엔 첫 장만 받아 첫 화면(LCP)이 빨리 뜨게 하고,
  // 페이지를 다 불러온 뒤 다음 장, 이후엔 바뀔 때마다 그다음 장을 미리 받는다 (LDP-222)
  const [preparedCount, setPreparedCount] = useState(1)
  // 첫 사진은 CSS 배경이라 브라우저가 늦게 발견한다 — 먼저 받으라고 알려 준다
  if (HERO_PHOTOS[0]) preload(HERO_PHOTOS[0], { as: 'image', fetchPriority: 'high' })
  // 메인 하단 "새로운 소식" — 공지 API 첫 3개(중요 고정 먼저, 최신순). 못 불러오면 구역을 숨긴다
  const [latestNotices, setLatestNotices] = useState<Notice[]>([])

  useEffect(() => {
    let ignore = false
    fetchNotices(1, 3)
      .then(({ notices }) => {
        if (!ignore) setLatestNotices(notices)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (HERO_PHOTOS.length < 2 || prefersReducedMotion()) return
    const prepareNext = () => setPreparedCount((count) => Math.max(count, 2))
    if (document.readyState === 'complete') prepareNext()
    else window.addEventListener('load', prepareNext, { once: true })
    const timer = window.setInterval(() => {
      setHeroIndex((i) => {
        const next = (i + 1) % HERO_PHOTOS.length
        setPreparedCount((count) => Math.max(count, next + 2))
        return next
      })
    }, HERO_INTERVAL_MS)
    return () => {
      window.removeEventListener('load', prepareNext)
      window.clearInterval(timer)
    }
  }, [])

  return (
    <>
      <section className="hero">
        {/* 사진을 겹쳐 두고 지금 사진만 불투명하게 — 바뀔 때 서서히 겹쳐 보인다 */}
        <div className="hero-slides" aria-hidden="true">
          {HERO_PHOTOS.map((photo, index) => (
            <div
              key={photo}
              className={`hero-slide${index === heroIndex ? ' is-active' : ''}`}
              style={index < preparedCount ? ({ '--main-hero-photo': `url(${photo})` } as CSSProperties) : undefined}
            />
          ))}
        </div>
        <div className="hero-content">
          <p className="hero-eyebrow">A Brand for value of time</p>
          <h1 className="hero-title">
            머무는 순간,
            <br />
            온전히 나를 위한 시간
          </h1>
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
          {hotels.map((hotel) => (
            <HotelCard key={hotel.id} hotel={hotel} lazyImage />
          ))}
        </div>
      </section>

      <section className="main-values">
        <div className="main-values-inner">
          <p className="main-section-eyebrow">Brand Value</p>
          <h2>머묾이 지키는 네 가지</h2>
          <div className="main-values-grid">
            {BRAND_VALUES.map((value) => (
              <Link key={value.slug} to={`/philosophy/${value.slug}`} className="main-value-tile">
                {/* 첫 화면 밖이라 화면에 가까워질 때 불러온다 (LDP-222) */}
                <img className="main-value-photo" src={value.image} alt="" width={600} height={800} loading="lazy" decoding="async" />
                <span className="main-value-label">{value.label}</span>
                <span className="main-value-title">{value.title}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {latestNotices.length > 0 && (
        <section className="main-news">
          <div className="hotel-intro-header">
            <h2>새로운 소식</h2>
            <Link to="/notices" className="hotel-intro-link">
              전체 공지 보기 →
            </Link>
          </div>
          <ul className="main-news-list">
            {latestNotices.map((notice) => (
              <li key={notice.noticeId}>
                <Link to={notice.hotelId ? `/notices?hotel=${notice.hotelId}` : '/notices'}>
                  <span className="main-news-category">
                    {notice.isPinned ? '중요' : (NOTICE_CATEGORY_LABEL[notice.category] ?? notice.category)}
                  </span>
                  <span className="main-news-title">
                    {/* 지점 공지는 지점 이름을 붙인다 (LDP-188) */}
                    {noticeBranchName(notice, hotels) && (
                      <span className="main-news-branch">{noticeBranchName(notice, hotels)}</span>
                    )}
                    {notice.title}
                  </span>
                  <time dateTime={notice.createdAt}>{formatNoticeDate(notice.createdAt)}</time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

export default MainPage
