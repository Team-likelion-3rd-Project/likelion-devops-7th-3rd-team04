import { Link, Navigate, NavLink, useParams } from 'react-router-dom'
import { BRAND_VALUES } from '../data/brandValues'
import { customerAuth } from '../api/tokenStore'
import { loginStateFrom } from '../utils/loginRedirect'
import './PhilosophyPage.css'

// 브랜드 가치 — 건축·디자인·자연·에코 (헤더 "브랜드 가치" 메뉴)
function PhilosophyPage() {
  const { slug } = useParams<{ slug: string }>()
  const value = BRAND_VALUES.find((item) => item.slug === slug)
  const accessToken = customerAuth.useAccessToken()

  if (!value) return <Navigate to={`/philosophy/${BRAND_VALUES[0].slug}`} replace />

  return (
    <article className="philosophy-page">
      {/* 왼쪽 세로 사진(메인 타일과 같은 사진) + 오른쪽 제목·소개 — 모바일은 위아래로 쌓인다 */}
      <section className="philosophy-intro">
        <img className="philosophy-photo" src={value.image} alt="" />
        <div className="philosophy-text">
          <p className="philosophy-eyebrow">{value.eyebrow}</p>
          <h1>{value.title}</h1>
          <p className="philosophy-lead">{value.lead}</p>
          <nav className="philosophy-tabs" aria-label="브랜드 가치">
            {BRAND_VALUES.map((item) => (
              <NavLink key={item.slug} to={`/philosophy/${item.slug}`}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </section>

      <div className="philosophy-band">
        <div className="philosophy-sections">
          {value.sections.map((section, index) => (
            <section key={section.title} className="philosophy-section">
              <span className="philosophy-section-no">{String(index + 1).padStart(2, '0')}</span>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </div>

      <section className="philosophy-cta">
        <h2>머묾에서 머물러 보세요</h2>
        <p>서울 · 부산 · 제주, 세 곳의 머묾이 기다립니다.</p>
        <div className="philosophy-cta-links">
          <Link to="/hotels" className="philosophy-cta-secondary">
            호텔 둘러보기
          </Link>
          <Link
            to={accessToken ? '/reservation' : '/login'}
            state={accessToken ? undefined : loginStateFrom('/reservation')}
            className="philosophy-cta-primary"
          >
            예약하기
          </Link>
        </div>
      </section>
    </article>
  )
}

export default PhilosophyPage
