import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { fetchAdminHotelRooms, fetchAdminHotels, fetchAdminUserById } from '../../api/adminApi'
import type { AdminHotel, AdminRoom, AdminUser } from '../../api/adminApi'
import { adminReservationErrorMessage, fetchAdminUserBookings } from '../../api/adminReservations'
import type { AdminBooking } from '../../api/adminReservations'
import { STATUS_LABEL } from '../../pages/reservationHistoryUtils'
import './AdminPages.css'

function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  // 목록에서 들어왔으면 보던 목록 조건(?page=&q=)으로 돌아간다 — 주소로 바로 들어왔으면 첫 페이지
  const listSearch = (useLocation().state as { listSearch?: string } | null)?.listSearch ?? ''
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined)
  const [user, setUser] = useState<AdminUser | null>(null)
  const [error, setError] = useState('')
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null)
  const [bookingsError, setBookingsError] = useState('')
  const [hotels, setHotels] = useState<AdminHotel[]>([])
  const [roomsByHotel, setRoomsByHotel] = useState<Map<number, AdminRoom[]>>(new Map())

  // userId가 바뀌면(다른 유저 상세로 이동) 렌더링 중에 바로 이전 데이터를 비워
  // 새 유저의 데이터가 도착하기 전까지 이전 유저 정보가 잠깐 보이지 않게 한다.
  if (loadedFor !== userId) {
    setLoadedFor(userId)
    setUser(null)
    setError('')
    setBookings(null)
    setBookingsError('')
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

  useEffect(() => {
    if (!userId) return
    let ignore = false

    fetchAdminUserBookings(userId)
      .then((data) => {
        if (!ignore) setBookings(data)
      })
      .catch((err) => {
        if (!ignore) setBookingsError(adminReservationErrorMessage(err, '예약 내역을 불러오지 못했습니다.'))
      })

    return () => {
      ignore = true
    }
  }, [userId])

  // 호텔·객실 이름은 표시용이라, 못 불러와도 예약은 번호로 보여 준다
  useEffect(() => {
    let ignore = false

    fetchAdminHotels()
      .then(async (hotelList) => {
        const roomLists = await Promise.all(hotelList.map((h) => fetchAdminHotelRooms(h.hotelId).catch(() => [])))
        if (ignore) return
        setHotels(hotelList)
        setRoomsByHotel(new Map(hotelList.map((h, i) => [h.hotelId, roomLists[i]])))
      })
      .catch(() => {})

    return () => {
      ignore = true
    }
  }, [])

  const hotelName = (id: number) => hotels.find((h) => h.hotelId === id)?.name ?? `지점 ${id}`
  const roomName = (hotelId: number, roomId: number) =>
    roomsByHotel.get(hotelId)?.find((r) => r.roomId === roomId)?.name ?? `객실 ${roomId}`

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
          {bookingsError && <p className="admin-state is-error">{bookingsError}</p>}
          {!bookingsError && !bookings && <p className="admin-state">불러오는 중...</p>}
          {!bookingsError && bookings?.length === 0 && <p className="admin-state">예약 내역이 없습니다.</p>}
          {!bookingsError && bookings && bookings.length > 0 && (
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
                  {bookings.map((b) => (
                    <tr key={b.reservationId} style={{ cursor: 'default' }}>
                      <td>{b.reservationId}</td>
                      <td>{hotelName(b.hotelId)}</td>
                      <td>{roomName(b.hotelId, b.roomId)}</td>
                      <td>{b.checkInDate}</td>
                      <td>{b.checkOutDate}</td>
                      <td>{STATUS_LABEL[b.status] ?? b.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default AdminUserDetailPage
