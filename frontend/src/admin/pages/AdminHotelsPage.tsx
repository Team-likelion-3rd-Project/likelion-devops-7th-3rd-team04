import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAdminHotels } from '../../api/adminApi'
import type { AdminHotel } from '../../api/adminApi'
import './AdminPages.css'

function AdminHotelsPage() {
  const navigate = useNavigate()
  const [hotels, setHotels] = useState<AdminHotel[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAdminHotels()
      .then(setHotels)
      .catch((err) => setError(err instanceof Error ? err.message : '호텔 목록을 불러오지 못했습니다.'))
  }, [])

  return (
    <section>
      <div className="admin-page-header">
        <h1>호텔 관리</h1>
        <p>전체 호텔 목록을 조회합니다.</p>
      </div>

      {error && <p className="admin-state is-error">{error}</p>}
      {!error && !hotels && <p className="admin-state">불러오는 중...</p>}
      {!error && hotels && hotels.length === 0 && <p className="admin-state">등록된 호텔이 없습니다.</p>}

      {!error && hotels && hotels.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>이름</th>
                <th>주소</th>
                <th>전화번호</th>
              </tr>
            </thead>
            <tbody>
              {hotels.map((hotel) => (
                <tr key={hotel.hotelId} onClick={() => navigate(`/admin/hotels/${hotel.hotelId}`)}>
                  <td>{hotel.hotelId}</td>
                  <td>{hotel.name}</td>
                  <td>{hotel.address}</td>
                  <td>{hotel.phoneNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default AdminHotelsPage
