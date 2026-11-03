import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchAdminHotels } from '../../api/adminApi'
import type { AdminHotel } from '../../api/adminApi'
import { fetchNotices, formatNoticeDate, NOTICE_CATEGORY_LABEL, noticeBranchName } from '../../api/notices'
import type { Notice, NoticeCategory } from '../../api/notices'
import {
  createNotice,
  deleteNotice,
  NOTICE_BODY_MAX,
  NOTICE_TITLE_MAX,
  noticeErrorMessage,
  updateNotice,
} from '../../api/adminNotices'
import type { NoticeInput } from '../../api/adminNotices'
import { useAdminScope } from '../adminScope'
import './AdminPages.css'

// 공지 관리 (LDP-149 #295, API: LDP-147 #293). 고객 공지사항·메인 "새로운 소식"에 바로 반영된다.
// 지점별 공지 (LDP-188): 본사는 전체 공지 또는 지점 공지를 고르고, 지점 관리자는 자기 지점 공지만 쓴다.
// 지점 관리자 목록에는 자기 지점 공지 + 전체 공지가 보이고, 전체 공지는 고칠 수 없다(서버도 403).
function AdminNoticesPage() {
  const scope = useAdminScope()
  const emptyForm: NoticeInput = { title: '', body: '', category: 'NOTICE', isPinned: false, hotelId: scope.hotelId }
  const [hotels, setHotels] = useState<AdminHotel[]>([])
  const [notices, setNotices] = useState<Notice[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [notice, setNotice] = useState('')

  // 작성·수정 폼: editing이 null이면 닫힘, 'new'면 새 공지, 숫자면 그 공지 수정
  const [editing, setEditing] = useState<'new' | number | null>(null)
  const [form, setForm] = useState<NoticeInput>(emptyForm)
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // 지점 이름·대상 선택용 (지점 계정은 자기 지점만 받는다)
  useEffect(() => {
    let ignore = false
    fetchAdminHotels()
      .then((list) => {
        if (!ignore) setHotels(list)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false
    fetchNotices(undefined, undefined, scope.hotelId ?? undefined)
      .then(({ notices: list }) => {
        if (ignore) return
        setNotices(list)
        setLoadError('')
      })
      .catch((err) => {
        if (!ignore) setLoadError(noticeErrorMessage(err, '공지 목록을 불러오지 못했습니다.'))
      })
    return () => {
      ignore = true
    }
  }, [reloadKey, scope.hotelId])

  const branchLabel = (n: Notice) => noticeBranchName(n, hotels) ?? '전체 공지'
  // 지점 관리자는 자기 지점 공지만 고치고 지운다
  const canEdit = (n: Notice) => scope.hotelId === null || n.hotelId === scope.hotelId
  const ownBranchName = hotels.find((h) => h.hotelId === scope.hotelId)?.name ?? `지점 ${scope.hotelId}`

  const openForm = (target: 'new' | Notice) => {
    setNotice('')
    setFormError('')
    if (target === 'new') {
      setEditing('new')
      setForm(emptyForm)
    } else {
      setEditing(target.noticeId)
      setForm({
        title: target.title,
        body: target.body,
        category: target.category,
        isPinned: target.isPinned,
        hotelId: target.hotelId,
      })
    }
  }

  const finish = (message: string) => {
    setEditing(null)
    setNotice(message)
    setReloadKey((k) => k + 1)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const input = { ...form, title: form.title.trim(), body: form.body.trim() }
    if (!input.title || input.title.length > NOTICE_TITLE_MAX) {
      setFormError(`제목을 1~${NOTICE_TITLE_MAX}자로 입력해 주세요.`)
      return
    }
    if (!input.body || input.body.length > NOTICE_BODY_MAX) {
      setFormError(`내용을 1~${NOTICE_BODY_MAX.toLocaleString()}자로 입력해 주세요.`)
      return
    }
    setIsSaving(true)
    setFormError('')
    try {
      if (editing === 'new') {
        const created = await createNotice(input)
        const where = created.hotelId === null ? '모든 지점' : `${branchLabel(created)} 화면`
        finish(`공지 "${created.title}"을(를) 올렸습니다. ${where}에 바로 보입니다.`)
      } else if (editing !== null) {
        await updateNotice(editing, input)
        finish(`공지 "${input.title}"을(를) 수정했습니다.`)
      }
    } catch (err) {
      setFormError(noticeErrorMessage(err, '공지를 저장하지 못했습니다.'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (target: Notice) => {
    if (!window.confirm(`공지 "${target.title}"을(를) 삭제할까요? 삭제하면 되돌릴 수 없습니다.`)) return
    setNotice('')
    try {
      await deleteNotice(target.noticeId)
      if (editing === target.noticeId) setEditing(null)
      setNotice(`공지 "${target.title}"을(를) 삭제했습니다.`)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setLoadError(noticeErrorMessage(err, '공지를 삭제하지 못했습니다.'))
    }
  }

  return (
    <section>
      <div className="admin-page-header is-row">
        <h1>공지 관리</h1>
        <button type="button" className="admin-btn is-primary" onClick={() => openForm('new')}>
          새 공지 작성
        </button>
      </div>
      <p className="admin-stat-note">
        올리거나 고친 공지는 고객 공지사항과 메인 "새로운 소식"에 바로 보입니다. 중요 공지는 목록 맨 위에 고정됩니다.
        {scope.hotelId === null
          ? ' 전체 공지는 모든 지점에, 지점 공지는 그 지점 호텔 화면에만 보입니다.'
          : ` ${ownBranchName} 공지만 작성·수정할 수 있고, 본사 전체 공지는 볼 수만 있습니다.`}
      </p>

      {notice && <p className="admin-state is-success">{notice}</p>}

      {editing !== null && (
        <form className="admin-card admin-assign-panel" onSubmit={handleSubmit}>
          <div className="admin-card-header">
            <h2>{editing === 'new' ? '새 공지 작성' : '공지 수정'}</h2>
            <div className="admin-card-header-actions">
              <button type="button" className="admin-btn" onClick={() => setEditing(null)} disabled={isSaving}>
                닫기
              </button>
            </div>
          </div>
          <div className="admin-form">
            <div className="admin-assign-filters">
              <label className="admin-form-row">
                <span>대상</span>
                {scope.hotelId === null ? (
                  <select
                    value={form.hotelId ?? ''}
                    onChange={(e) => setForm({ ...form, hotelId: e.target.value === '' ? null : Number(e.target.value) })}
                  >
                    <option value="">전체 공지 (모든 지점)</option>
                    {hotels.map((h) => (
                      <option key={h.hotelId} value={h.hotelId}>
                        {h.name} 공지
                      </option>
                    ))}
                  </select>
                ) : (
                  <select value={scope.hotelId} disabled>
                    <option value={scope.hotelId}>{ownBranchName} 공지</option>
                  </select>
                )}
              </label>
              <label className="admin-form-row">
                <span>분류</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as NoticeCategory })}
                >
                  {Object.entries(NOTICE_CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-unit-check">
                <input
                  type="checkbox"
                  checked={form.isPinned}
                  onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
                />
                중요 공지 (목록 맨 위에 고정)
              </label>
            </div>
            <label className="admin-form-row">
              <span>
                제목 ({form.title.length}/{NOTICE_TITLE_MAX})
              </span>
              <input
                value={form.title}
                maxLength={NOTICE_TITLE_MAX}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="예: 예약 시스템 점검 안내 (10월 30일 02:00~04:00)"
              />
            </label>
            <label className="admin-form-row">
              <span>
                내용 ({form.body.length.toLocaleString()}/{NOTICE_BODY_MAX.toLocaleString()}) — 일반 글자만, 줄바꿈은
                그대로 보입니다
              </span>
              <textarea
                className="admin-notice-body"
                value={form.body}
                maxLength={NOTICE_BODY_MAX}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </label>
            {formError && <p className="admin-state is-error">{formError}</p>}
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn is-primary" disabled={isSaving}>
                {isSaving ? '저장 중...' : editing === 'new' ? '공지 올리기' : '수정 저장'}
              </button>
            </div>
          </div>
        </form>
      )}

      {loadError && <p className="admin-state is-error">{loadError}</p>}
      {!loadError && !notices && <p className="admin-state">불러오는 중...</p>}
      {!loadError && notices && notices.length === 0 && <p className="admin-state">등록된 공지가 없습니다.</p>}

      {notices && notices.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>번호</th>
                <th>대상</th>
                <th>분류</th>
                <th>제목</th>
                <th>작성일</th>
                <th>수정일</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {notices.map((n) => (
                <tr key={n.noticeId} className={editing === n.noticeId ? 'is-selected' : undefined}>
                  <td>#{n.noticeId}</td>
                  <td>
                    <span className={`admin-badge${n.hotelId === null ? '' : ' is-info'}`}>{branchLabel(n)}</span>
                  </td>
                  <td>
                    {n.isPinned && <span className="admin-badge is-warn">중요</span>}{' '}
                    {NOTICE_CATEGORY_LABEL[n.category] ?? n.category}
                  </td>
                  <td>{n.title}</td>
                  <td>{formatNoticeDate(n.createdAt)}</td>
                  <td>{n.updatedAt && n.updatedAt !== n.createdAt ? formatNoticeDate(n.updatedAt) : '-'}</td>
                  <td>
                    {canEdit(n) ? (
                      <div className="admin-reservation-actions">
                        <button type="button" className="admin-btn" onClick={() => openForm(n)}>
                          수정
                        </button>
                        <button type="button" className="admin-btn is-danger" onClick={() => handleDelete(n)}>
                          삭제
                        </button>
                      </div>
                    ) : (
                      <span className="admin-stat-note">본사 공지</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default AdminNoticesPage
