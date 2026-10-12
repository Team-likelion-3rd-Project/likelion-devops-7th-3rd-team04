import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchAdminHotelRooms, fetchAdminHotelStats, fetchAdminHotels } from '../../api/adminApi'
import type { AdminHotel, AdminHotelStats } from '../../api/adminApi'
import './AdminPages.css'

// 대시보드는 전역 합산 지표 대신 호텔별 요약 테이블을 보여준다. 점유율 같은 지표는 호텔마다
// 총 객실 수가 달라 단순 합산/평균이 의미가 없기 때문에(가중평균이 필요), 호텔별로 나란히 비교하고
// 바로 상세로 들어갈 수 있게 하는 편이 더 유용하다 — 실제 상세 지표는 AdminHotelDetailPage에 있다.
interface HotelSummaryRow {
  hotel: AdminHotel
  stats: AdminHotelStats
  totalRooms: number
}

function AdminDashboardPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<HotelSummaryRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false

    fetchAdminHotels()
      .then(async (hotels) => {
        const summaries = await Promise.all(
          hotels.map(async (hotel) => {
            const [stats, rooms] = await Promise.all([
              fetchAdminHotelStats(hotel.hotelId),
              fetchAdminHotelRooms(hotel.hotelId),
            ])
            return { hotel, stats, totalRooms: rooms.length }
          }),
        )
        if (!ignore) setRows(summaries)
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : '호텔 지표를 불러오지 못했습니다.')
      })

    return () => {
      ignore = true
    }
  }, [])

  return (
    <section>
      <div className="admin-page-header">
        <h1>대시보드</h1>
        <p>관리자 콘솔에 오신 것을 환영합니다.</p>
      </div>

      {error && <p className="admin-state is-error">{error}</p>}
      {!error && !rows && <p className="admin-state">불러오는 중...</p>}
      {!error && rows && rows.length === 0 && <p className="admin-state">등록된 호텔이 없습니다.</p>}

      {!error && rows && rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table admin-dashboard-stat-table">
            <thead>
              <tr>
                <th>호텔</th>
                <th>오늘 예정된 체크인 / 체크아웃</th>
                <th>오늘 객실 점유율</th>
                <th>오늘 매출 현황</th>
                <th>신규 예약 / 취소 건수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ hotel, stats, totalRooms }) => (
                <tr key={hotel.hotelId} onClick={() => navigate(`/admin/hotels/${hotel.hotelId}`)}>
                  <td>{hotel.name}</td>
                  <td>
                    {stats.checkInsToday} / {stats.checkOutsToday}
                  </td>
                  <td>
                    {totalRooms > 0 ? `${Math.round((stats.occupiedRoomsToday / totalRooms) * 100)}%` : '—%'}
                  </td>
                  <td>₩{stats.revenueToday.toLocaleString()}</td>
                  <td>
                    {stats.newReservationsToday} / {stats.cancellationsToday}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-dashboard-grid">
        <Link to="/admin/users" className="admin-card admin-dashboard-card">
          <h2>유저 관리</h2>
          <p>전체 유저 목록 및 상세 정보를 조회합니다.</p>
        </Link>
        <Link to="/admin/hotels" className="admin-card admin-dashboard-card">
          <h2>호텔 관리</h2>
          <p>전체 호텔 목록 및 상세 정보를 조회합니다.</p>
        </Link>
      </div>
    </section>
  )
}

export default AdminDashboardPage
