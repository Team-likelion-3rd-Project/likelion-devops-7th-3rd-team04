import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { searchAdminUsers } from '../../api/adminApi'
import type { AdminUser } from '../../api/adminApi'
import { adminReservationErrorMessage } from '../../api/adminReservations'
import AdminPagination from '../components/AdminPagination'
import './AdminPages.css'

// 한 페이지에 보여 줄 회원 수 (서버 기본 20)
const PAGE_SIZE = 20

// 유저 관리 — 서버 검색·페이지(LDP-156, API: LDP-136 #287). 최근 가입 순.
// 페이지·검색어를 주소(?page=&q=)에 두어 회원 상세에서 뒤로 와도 보던 목록이 유지된다.
function AdminUsersPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const keyword = searchParams.get('q') ?? ''

  const [query, setQuery] = useState(keyword)
  const [result, setResult] = useState<{ users: AdminUser[]; total: number } | null>(null)
  const [error, setError] = useState('')

  // 검색어는 입력이 멈추고 0.3초 뒤에 주소로 반영(→ 조회). 검색어가 바뀌면 1페이지부터
  useEffect(() => {
    const next = query.trim()
    if (next === keyword) return
    const timer = window.setTimeout(() => {
      setSearchParams(next ? { q: next } : {}, { replace: true })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, keyword, setSearchParams])

  useEffect(() => {
    let ignore = false
    searchAdminUsers(keyword, page, PAGE_SIZE)
      .then((data) => {
        if (ignore) return
        setResult(data)
        setError('')
      })
      .catch((err) => {
        if (!ignore) setError(adminReservationErrorMessage(err, '유저 목록을 불러오지 못했습니다.'))
      })
    return () => {
      ignore = true
    }
  }, [keyword, page])

  const goToPage = (next: number) => {
    const params: Record<string, string> = { page: String(next) }
    if (keyword) params.q = keyword
    setSearchParams(params)
  }

  const users = result?.users ?? []
  const total = result?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <section>
      <div className="admin-page-header">
        <h1>유저 관리</h1>
        <p>회원 목록을 최근 가입 순으로 조회합니다.</p>
      </div>

      <div className="admin-card">
        <div className="admin-assign-filters">
          <label className="admin-form-row">
            <span>검색 (이름·이메일·연락처)</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 홍길동, 010-1234" />
          </label>
        </div>
      </div>

      {error && <p className="admin-state is-error">{error}</p>}
      {!error && !result && <p className="admin-state">불러오는 중...</p>}

      {!error && result && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>
              회원 목록 (전체 {total.toLocaleString()}명 · {page}/{lastPage}페이지)
            </h2>
          </div>
          {users.length === 0 ? (
            <p className="admin-state">{keyword ? '검색 결과가 없습니다.' : '등록된 유저가 없습니다.'}</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>이메일</th>
                    <th>이름</th>
                    <th>전화번호</th>
                    <th>등급</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} onClick={() => navigate(`/admin/users/${user.id}`)}>
                      <td>{user.id}</td>
                      <td>{user.email}</td>
                      <td>{user.name}</td>
                      <td>{user.phoneNumber}</td>
                      <td>
                        <span className="admin-badge">{user.role}</span>
                      </td>
                      <td>{user.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AdminPagination page={page} lastPage={lastPage} onChange={goToPage} label="회원 목록 페이지" />
        </div>
      )}
    </section>
  )
}

export default AdminUsersPage
