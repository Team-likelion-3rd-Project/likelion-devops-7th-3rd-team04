import { Link } from 'react-router-dom'
import '../pages/AdminPages.css'

// 관리자 화면의 안내 카드 (LDP-158) — 없는 주소는 404, 화면 오류는 새로고침 버튼을 함께 보여준다.
export function AdminNotFound() {
  return (
    <div className="admin-card admin-status">
      <span className="admin-status-code">404</span>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>주소를 다시 확인하거나 왼쪽 메뉴에서 이동해 주세요.</p>
      <div className="admin-status-actions">
        <Link to="/admin" className="admin-btn is-primary">
          대시보드로
        </Link>
      </div>
    </div>
  )
}

export function AdminErrorFallback() {
  return (
    <div className="admin-card admin-status" role="alert">
      <span className="admin-status-code">!</span>
      <h1>일시적인 오류가 발생했습니다</h1>
      <p>새로고침하거나 왼쪽 메뉴에서 다른 화면으로 이동해 주세요.</p>
      <div className="admin-status-actions">
        <Link to="/admin" className="admin-btn">
          대시보드로
        </Link>
        <button type="button" className="admin-btn is-primary" onClick={() => window.location.reload()}>
          새로고침
        </button>
      </div>
    </div>
  )
}
