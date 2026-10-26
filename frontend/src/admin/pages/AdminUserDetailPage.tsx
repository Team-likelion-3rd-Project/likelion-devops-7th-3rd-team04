import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { fetchAdminUserById } from '../../api/adminApi'
import type { AdminUser } from '../../api/adminApi'
import './AdminPages.css'

function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  // 목록에서 들어왔으면 보던 목록 조건(?page=&q=)으로 돌아간다 — 주소로 바로 들어왔으면 첫 페이지
  const listSearch = (useLocation().state as { listSearch?: string } | null)?.listSearch ?? ''
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined)
  const [user, setUser] = useState<AdminUser | null>(null)
  const [error, setError] = useState('')

  // userId가 바뀌면(다른 유저 상세로 이동) 렌더링 중에 바로 이전 데이터를 비워
  // 새 유저의 데이터가 도착하기 전까지 이전 유저 정보가 잠깐 보이지 않게 한다.
  if (loadedFor !== userId) {
    setLoadedFor(userId)
    setUser(null)
    setError('')
  }

  useEffect(() => {
    if (!userId) return
    let ignore = false

    fetchAdminUserById(userId)
      .then((data) => {
        if (!ignore) setUser(data)
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : '유저 정보를 불러오지 못했습니다.')
      })

    return () => {
      ignore = true
    }
  }, [userId])

  return (
    <section>
      <button type="button" className="admin-back-link" onClick={() => navigate(`/admin/users${listSearch}`)}>
        ← 유저 목록으로
      </button>

      <div className="admin-page-header">
        <h1>유저 상세</h1>
      </div>

      {error && <p className="admin-state is-error">{error}</p>}
      {!error && !user && <p className="admin-state">불러오는 중...</p>}

      {!error && user && (
        <div className="admin-card">
          <dl className="admin-detail-grid">
            <dt>ID</dt>
            <dd>{user.id}</dd>
            <dt>이메일</dt>
            <dd>{user.email}</dd>
            <dt>이름</dt>
            <dd>{user.name}</dd>
            <dt>전화번호</dt>
            <dd>{user.phoneNumber}</dd>
            <dt>등급</dt>
            <dd>
              <span className="admin-badge">{user.role}</span>
            </dd>
            <dt>상태</dt>
            <dd>{user.status}</dd>
          </dl>
        </div>
      )}

      {!error && user && (
        <div className="admin-card">
          <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>예약 내역</h2>
          {/* TODO: 예약 서비스(booking-service) API가 준비되면 adminApi.ts에
              fetchAdminUserReservations(userId)를 추가해 이 자리에서 호출한다.
              응답 형태가 정해지면 아래 테이블 컬럼(호텔/객실/체크인·아웃/상태 등)도 맞춰 조정. */}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>예약 ID</th>
                  <th>호텔</th>
                  <th>객실</th>
                  <th>체크인</th>
                  <th>체크아웃</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ cursor: 'default' }}>
                  <td colSpan={6}>
                    <p className="admin-state">예약 서비스가 아직 준비 중입니다. 연동되면 이 유저의 예약 내역이 여기에 표시됩니다.</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default AdminUserDetailPage
