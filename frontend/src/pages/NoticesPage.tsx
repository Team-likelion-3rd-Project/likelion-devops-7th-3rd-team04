import { NOTICES } from '../data/notices'
import './NoticesPage.css'

// 공지사항 — 고정 공지를 위에, 나머지는 최신순. 제목을 누르면 내용이 펼쳐진다.
function NoticesPage() {
  const notices = [...NOTICES].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.date.localeCompare(a.date),
  )

  return (
    <section className="notices-page">
      <header className="notices-header">
        <p className="notices-eyebrow">Notice</p>
        <h1>공지사항</h1>
        <p className="notices-intro">머묾의 새로운 소식과 이용 안내를 전해 드립니다.</p>
      </header>

      <ul className="notice-list">
        {notices.map((notice) => (
          <li key={notice.id}>
            <details className="notice-item">
              <summary>
                <span className={`notice-category is-${notice.pinned ? 'pinned' : 'normal'}`}>
                  {notice.pinned ? '중요' : notice.category}
                </span>
                <span className="notice-title">{notice.title}</span>
                <time className="notice-date" dateTime={notice.date}>
                  {notice.date.replaceAll('-', '.')}
                </time>
              </summary>
              <p className="notice-body">{notice.body}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default NoticesPage
