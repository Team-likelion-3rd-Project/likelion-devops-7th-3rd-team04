const BASE_URL = import.meta.env.VITE_API_URL ?? ''

// ─── 공지사항 (LDP-147 #293 API, 메인 V12 notices) — 고객 화면용 공개 조회 ─────────────────────
// 관리자 작성·수정·삭제는 api/adminNotices.ts (관리자 코드가 고객 번들에 섞이지 않게 나눈다)

export type NoticeCategory = 'NOTICE' | 'EVENT' | 'MAINTENANCE'

export const NOTICE_CATEGORY_LABEL: Record<NoticeCategory, string> = {
  NOTICE: '안내',
  EVENT: '이벤트',
  MAINTENANCE: '점검',
}

export interface Notice {
  noticeId: number
  title: string
  /** 일반 텍스트 — HTML로 해석하지 않고 줄바꿈만 살려서 보여 준다 */
  body: string
  category: NoticeCategory
  isPinned: boolean
  /** 작성 직원 (seed 공지는 null) */
  createdByAdminId: number | null
  /** 대상 지점 (LDP-188). null = 전체 공지 — 모든 지점 화면에 보인다 */
  hotelId: number | null
  createdAt: string
  updatedAt: string
}

// GET /api/notices — 중요 고정 먼저, 그다음 최신순. page를 주면 그 페이지만(size 기본 20), 생략하면 전체.
// hotelId를 주면 그 지점 공지 + 전체 공지만 (LDP-188)
export async function fetchNotices(
  page?: number,
  size?: number,
  hotelId?: number,
): Promise<{ notices: Notice[]; total: number }> {
  const params = new URLSearchParams()
  if (page) params.set('page', String(page))
  if (size) params.set('size', String(size))
  if (hotelId) params.set('hotelId', String(hotelId))
  const query = params.toString()
  const res = await fetch(`${BASE_URL}/api/notices${query ? `?${query}` : ''}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const data = (await res.json()) as { notices?: Notice[]; total?: number }
  return { notices: data.notices ?? [], total: data.total ?? 0 }
}

// 공지 대상 표시 — 전체 공지는 null, 지점 공지는 지점 이름 (목록에 이름이 없으면 "지점 N")
export function noticeBranchName(notice: Notice, hotels: { hotelId: number; name: string }[]): string | null {
  if (notice.hotelId === null) return null
  return hotels.find((h) => h.hotelId === notice.hotelId)?.name ?? `지점 ${notice.hotelId}`
}

// "2026.10.23" — 작성일 표시용
export function formatNoticeDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10).replaceAll('-', '.')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}.${m}.${d}`
}
