import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchNotices, formatNoticeDate, NOTICE_CATEGORY_LABEL, noticeBranchName } from '../api/notices'
import type { Notice } from '../api/notices'
import { useHotels } from '../data/hotelStore'
import './NoticesPage.css'

// 공지사항 — 공지 API(LDP-147)가 중요 고정 먼저, 최신순으로 내려준다. 제목을 누르면 내용이 펼쳐진다.
// 지점별 공지 (LDP-188): ?hotel=1이면 그 지점 공지 + 전체 공지만. 지점 공지에는 지점 이름을 붙인다.
function NoticesPage() {
  const hotels = useHotels()
  const [searchParams, setSearchParams] = useSearchParams()
  const hotelFilter = Number(searchParams.get('hotel')) || undefined
  const [notices, setNotices] = useState<Notice[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let ignore = false
    fetchNotices(undefined, undefined, hotelFilter)
      .then(({ notices: list }) => {
        if (!ignore) setNotices(list)
      })
      .catch(() => {
        if (!ignore) setLoadError('일시적으로 공지사항을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
      })
    return () => {
      ignore = true
    }
  }, [retryKey, hotelFilter])

  // 지점을 바꾸면 이전 목록 대신 "불러오는 중"을 보여 준다
  const selectFilter = (hotelId?: number) => {
    if (hotelId === hotelFilter) return
    setLoadError('')
    setNotices(null)
    setSearchParams(hotelId ? { hotel: String(hotelId) } : {}, { replace: true })
  }

  return (
    <section className="notices-page">
      <header className="notices-header">
        <p className="notices-eyebrow">Notice</p>
        <h1>공지사항</h1>
        <p className="notices-intro">머묾의 새로운 소식과 이용 안내를 전해 드립니다.</p>

        <div className="notice-filter" role="group" aria-label="지점별 공지 보기">
          <button
            type="button"
            className={`notice-filter-chip${hotelFilter ? '' : ' is-active'}`}
            aria-pressed={!hotelFilter}
            onClick={() => selectFilter()}
          >
            전체
          </button>
          {hotels.map((hotel) => (
            <button
              key={hotel.hotelId}
              type="button"
              className={`notice-filter-chip${hotelFilter === hotel.hotelId ? ' is-active' : ''}`}
              aria-pressed={hotelFilter === hotel.hotelId}
              onClick={() => selectFilter(hotel.hotelId)}
            >
              {hotel.name}
            </button>
          ))}
        </div>
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
                <span className="notice-title">
                  {noticeBranchName(notice, hotels) && (
                    <span className="notice-branch">{noticeBranchName(notice, hotels)}</span>
                  )}
                  {notice.title}
                </span>
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
