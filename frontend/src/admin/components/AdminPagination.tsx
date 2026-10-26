// 관리자 목록 페이지 이동 (예약 관리·유저 관리 공용) — 지금 페이지 앞뒤 2개씩, 처음·끝은 항상 보여 준다
interface AdminPaginationProps {
  page: number
  lastPage: number
  onChange: (page: number) => void
  /** 스크린 리더용 이름 (예: "예약 목록 페이지") */
  label: string
}

function pageNumbers(current: number, last: number): (number | '…')[] {
  const pages: (number | '…')[] = []
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || Math.abs(p - current) <= 2) pages.push(p)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }
  return pages
}

function AdminPagination({ page, lastPage, onChange, label }: AdminPaginationProps) {
  if (lastPage <= 1) return null
  return (
    <nav className="admin-pagination" aria-label={label}>
      <button type="button" className="admin-btn" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        ‹ 이전
      </button>
      {pageNumbers(page, lastPage).map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="admin-pagination-gap">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={`admin-btn${p === page ? ' is-primary' : ''}`}
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" className="admin-btn" onClick={() => onChange(page + 1)} disabled={page >= lastPage}>
        다음 ›
      </button>
    </nav>
  )
}

export default AdminPagination
