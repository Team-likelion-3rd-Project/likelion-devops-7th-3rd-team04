import { authedFetch, authedJsonFetch } from './adminApi'
import { adminErrorMessage } from '../admin/adminScope'
import { ApiError } from './gateway'
import type { Notice, NoticeCategory } from './notices'

// ─── 공지사항 관리자 작성·수정·삭제 (LDP-147 #293) ─────────────────────────────────────────

export interface NoticeInput {
  title: string
  body: string
  category: NoticeCategory
  isPinned: boolean
  /** 대상 지점 (LDP-188). null = 전체 공지(본사만). 지점 관리자는 자기 지점만 */
  hotelId: number | null
}

export const NOTICE_TITLE_MAX = 200
export const NOTICE_BODY_MAX = 10000

const NOTICE_ERROR_MESSAGE: Record<string, string> = {
  NOTICE_NOT_FOUND: '공지를 찾을 수 없습니다. 이미 삭제됐을 수 있으니 목록을 새로고침해 주세요.',
  HOTEL_SERVICE_UNAVAILABLE: '공지 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  HOTEL_NOT_FOUND: '대상 지점을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
}

export function noticeErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code && NOTICE_ERROR_MESSAGE[err.code]) return NOTICE_ERROR_MESSAGE[err.code]
  return err instanceof Error && err.message ? err.message : fallback
}

// 실패 응답 { statusCode, error, code, message } — code를 담아 던진다 (검사 오류는 message가 배열)
async function parseNoticeResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
    throw new ApiError(adminErrorMessage(body?.code, message ?? `${res.status} ${res.statusText}`), res.status, body?.code)
  }
  return body as T
}

// POST /api/notices (관리자 전용)
export async function createNotice(input: NoticeInput): Promise<Notice> {
  return parseNoticeResponse<Notice>(await authedJsonFetch('/api/notices', 'POST', input))
}

// PUT /api/notices/{id} (관리자 전용) — 모든 칸을 함께 보낸다 (isPinned 생략 = 고정 해제)
export async function updateNotice(noticeId: number, input: NoticeInput): Promise<Notice> {
  return parseNoticeResponse<Notice>(await authedJsonFetch(`/api/notices/${noticeId}`, 'PUT', input))
}

// DELETE /api/notices/{id} (관리자 전용) — 실제 삭제
export async function deleteNotice(noticeId: number): Promise<void> {
  return parseNoticeResponse<void>(await authedFetch(`/api/notices/${noticeId}`, { method: 'DELETE' }))
}
