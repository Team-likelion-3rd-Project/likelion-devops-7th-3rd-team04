import './PlaceholderPage.css'

interface PlaceholderPageProps {
  title: string
  description?: string
}

/** 라우팅 골격만 먼저 잡아두는 페이지용 공통 placeholder. 콘텐츠는 추후 작업. */
function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <section className="placeholder-page">
      <h1>{title}</h1>
      <p>{description ?? '준비 중인 페이지입니다.'}</p>
    </section>
  )
}

export default PlaceholderPage
