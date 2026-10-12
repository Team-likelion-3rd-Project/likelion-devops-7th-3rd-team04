import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAdminUsers } from '../../api/adminApi'
import type { AdminUser } from '../../api/adminApi'
import './AdminPages.css'

function AdminUsersPage() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : '유저 목록을 불러오지 못했습니다.'))
  }, [])

  return (
    <section>
      <div className="admin-page-header">
        <h1>유저 관리</h1>
        <p>전체 회원 목록을 조회합니다.</p>
      </div>

      {error && <p className="admin-state is-error">{error}</p>}
      {!error && !users && <p className="admin-state">불러오는 중...</p>}
      {!error && users && users.length === 0 && <p className="admin-state">등록된 유저가 없습니다.</p>}

      {!error && users && users.length > 0 && (
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
    </section>
  )
}

export default AdminUsersPage
