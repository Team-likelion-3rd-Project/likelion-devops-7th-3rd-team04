import { Link } from 'react-router-dom'
import './StatusPage.css'

/** 없는 주소(오타·예전 링크)로 들어왔을 때 보여주는 화면 (LDP-158). 헤더·푸터는 RootLayout이 그대로 그린다. */
function NotFoundPage() {
  return (
    <section className="status-page">
      <div className="status-card">
        <span className="status-code" aria-hidden="true">
          404
        </span>
        <h1>페이지를 찾을 수 없습니다</h1>
        <p>주소가 바뀌었거나 없는 페이지입니다.</p>
        <p>입력하신 주소를 다시 확인해 주세요.</p>
        <div className="status-actions">
          <Link to="/hotels" className="status-secondary">
            호텔 둘러보기
          </Link>
          <Link to="/" className="status-primary">
            홈으로
          </Link>
        </div>
      </div>
    </section>
  )
}

export default NotFoundPage
