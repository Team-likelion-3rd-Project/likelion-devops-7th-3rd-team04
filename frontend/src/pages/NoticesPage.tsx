import { useEffect, useState } from 'react'
import { fetchNotices, formatNoticeDate, NOTICE_CATEGORY_LABEL } from '../api/notices'
import type { Notice } from '../api/notices'
import './NoticesPage.css'

// 공지사항 — 공지 API(LDP-147)가 중요 고정 먼저, 최신순으로 내려준다. 제목을 누르면 내용이 펼쳐진다.
function NoticesPage() {
  const [notices, setNotices] = useState<Notice[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let ignore = false
    fetchNotices()
      .then(({ notices: list }) => {
        if (!ignore) setNotices(list)
      })
      .catch(() => {
        if (!ignore) setLoadError('일시적으로 공지사항을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
      })
    return () => {
      ignore = true
    }
  }, [retryKey])

  return (
    <section className="notices-page">
      <header className="notices-header">
        <p className="notices-eyebrow">Notice</p>
        <h1>공지사항</h1>
        <p className="notices-intro">머묾의 새로운 소식과 이용 안내를 전해 드립니다.</p>
      </header>

      <ul className="notice-list">
        {loadError && (
          <li className="notice-status">
            {loadError}{' '}
            <button type="button" className="notice-retry" onClick={() => {
                setLoadError('')
                setRetryKey((k) => k + 1)
              }}>
              다시 시도
            </button>
          </li>
        )}
        {!loadError && !notices && <li className="notice-status">불러오는 중…</li>}
        {!loadError && notices?.length === 0 && <li className="notice-status">등록된 공지사항이 없습니다.</li>}
        {notices?.map((notice) => (
          <li key={notice.noticeId}>
            <details className="notice-item">
              <summary>
                <span className={`notice-category is-${notice.isPinned ? 'pinned' : 'normal'}`}>
                  {notice.isPinned ? '중요' : (NOTICE_CATEGORY_LABEL[notice.category] ?? notice.category)}
                </span>
                <span className="notice-title">{notice.title}</span>
                <time className="notice-date" dateTime={notice.createdAt}>
                  {formatNoticeDate(notice.createdAt)}
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
