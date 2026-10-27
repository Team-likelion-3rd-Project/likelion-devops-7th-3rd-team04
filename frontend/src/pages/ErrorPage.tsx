import { Link } from 'react-router-dom'
import './StatusPage.css'

/** 화면을 그리다 오류가 났을 때 ErrorBoundary가 대신 보여주는 화면 (LDP-158).
 * 새 버전 배포 직후 예전 화면 파일을 못 불러오는 경우도 새로고침하면 풀린다. */
function ErrorPage() {
  return (
    <section className="status-page">
      <div className="status-card" role="alert">
        <span className="status-code" aria-hidden="true">
          !
        </span>
        <h1>일시적인 오류가 발생했습니다</h1>
        <p>화면을 불러오는 중 문제가 생겼습니다.</p>
        <p>새로고침하거나 잠시 후 다시 시도해 주세요.</p>
        <div className="status-actions">
          <Link to="/" className="status-secondary">
            홈으로
          </Link>
          <button type="button" className="status-primary" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      </div>
    </section>
  )
}

export default ErrorPage
