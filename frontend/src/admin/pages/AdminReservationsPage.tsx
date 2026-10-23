import { useEffect, useMemo, useState } from 'react'
import { fetchAdminHotelRooms, fetchAdminHotels, fetchAdminUsers } from '../../api/adminApi'
import type { AdminHotel, AdminRoom, AdminUser } from '../../api/adminApi'
import { adminReservationErrorMessage, fetchAdminBookings } from '../../api/adminReservations'
import type { AdminBooking } from '../../api/adminReservations'
import { STATUS_LABEL } from '../../pages/reservationHistoryUtils'
import AdminProxyBookingForm from '../components/AdminProxyBookingForm'
import AdminReservationActionPanel from '../components/AdminReservationActionPanel'
import type { ReservationAction } from '../components/AdminReservationActionPanel'
import './AdminPages.css'

// 직원이 처리할 수 있는(취소·연장 대상이 되는) 진행 중 예약 상태
const ACTIVE_STATUSES = ['PENDING_PAYMENT', 'RESERVED']

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'ACTIVE', label: '진행 중 (결제 대기·예약 확정)' },
  { value: '', label: '전체' },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

function statusBadgeClass(status: string): string {
  if (status === 'RESERVED' || status === 'COMPLETED') return 'admin-badge is-good'
  if (status === 'PENDING_PAYMENT') return 'admin-badge is-warn'
  return 'admin-badge is-bad'
}

// 예약 관리: 전체 예약 목록 + 대리 예약 만들기 + 직원 취소 + 투숙 연장 (LDP-118 #224, API: LDP-90 #204).
// 서버 목록 API에 필터가 없어 지점·상태·검색은 화면에서 거른다.
function AdminReservationsPage() {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null)
  const [hotels, setHotels] = useState<AdminHotel[]>([])
  const [roomsByHotel, setRoomsByHotel] = useState<Map<number, AdminRoom[]>>(new Map())
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [hotelFilter, setHotelFilter] = useState<number | ''>('')
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [query, setQuery] = useState('')

  const [isCreating, setIsCreating] = useState(false)
  const [selected, setSelected] = useState<{ booking: AdminBooking; action: ReservationAction } | null>(null)
  const [notice, setNotice] = useState('')

  // 지점·객실 종류·회원은 처음 한 번만 불러온다 (이름 표시·대리 예약 폼용)
  useEffect(() => {
    let ignore = false
    Promise.all([fetchAdminHotels(), fetchAdminUsers()])
      .then(async ([hotelList, userList]) => {
        const roomLists = await Promise.all(hotelList.map((h) => fetchAdminHotelRooms(h.hotelId).catch(() => [])))
        if (ignore) return
        setHotels(hotelList)
        setUsers(userList)
        setRoomsByHotel(new Map(hotelList.map((h, i) => [h.hotelId, roomLists[i]])))
      })
      .catch((err) => {
        if (!ignore) setLoadError(err instanceof Error ? err.message : '지점·회원 정보를 불러오지 못했습니다.')
      })
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false
    fetchAdminBookings()
      .then((data) => {
        if (ignore) return
        setBookings(data)
        setLoadError('')
      })
      .catch((err) => {
        if (!ignore) setLoadError(adminReservationErrorMessage(err, '예약 목록을 불러오지 못했습니다.'))
      })
    return () => {
      ignore = true
    }
  }, [reloadKey])

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const hotelName = (id: number) => hotels.find((h) => h.hotelId === id)?.name ?? `지점 ${id}`
  const roomName = (hotelId: number, roomId: number) =>
    roomsByHotel.get(hotelId)?.find((r) => r.roomId === roomId)?.name ?? `객실 ${roomId}`
  const guestLabel = (userId: number) => {
    const user = usersById.get(userId)
    return user ? `${user.name} (${user.email})` : `회원 #${userId}`
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (bookings ?? [])
      .filter((b) => (hotelFilter === '' ? true : b.hotelId === hotelFilter))
      .filter((b) =>
        statusFilter === 'ACTIVE' ? ACTIVE_STATUSES.includes(b.status) : statusFilter ? b.status === statusFilter : true,
      )
      .filter((b) => {
        if (!q) return true
        const user = usersById.get(b.userId)
        return [String(b.reservationId), user?.name, user?.email, user?.phoneNumber, b.roomNumber].some((v) =>
          v?.toLowerCase().includes(q),
        )
      })
      .sort((a, b) => b.reservationId - a.reservationId)
  }, [bookings, hotelFilter, statusFilter, query, usersById])

  // 연장 묶음: linkedReservationId = 맨 처음 원래 예약. 원래 예약을 취소하면 진행 중인 연장 예약도 함께 취소되고,
  // 연장의 연장은 가장 최근 연장 예약에서 요청해야 한다.
  const extensionsOf = (booking: AdminBooking) => {
    const rootId = booking.linkedReservationId ?? booking.reservationId
    return (bookings ?? []).filter((b) => b.linkedReservationId === rootId && ACTIVE_STATUSES.includes(b.status))
  }

  const openAction = (booking: AdminBooking, action: ReservationAction) => {
    setIsCreating(false)
    setNotice('')
    setSelected({ booking, action })
  }

  const finish = (message: string) => {
    setSelected(null)
    setIsCreating(false)
    setNotice(message)
    setReloadKey((k) => k + 1)
  }

  return (
    <section>
      <div className="admin-page-header is-row">
        <h1>예약 관리</h1>
        <button
          type="button"
          className="admin-btn is-primary"
          onClick={() => {
            setSelected(null)
            setNotice('')
            setIsCreating(true)
          }}
          disabled={hotels.length === 0}
        >
          대리 예약 만들기
        </button>
      </div>
      <p className="admin-stat-note">
        직원이 만든 예약(대리 예약·연장)은 손님 앱의 결제 대기에 나타나고, 손님이 결제해야 확정됩니다.
      </p>

      {notice && <p className="admin-state is-success">{notice}</p>}

      {isCreating && (
        <AdminProxyBookingForm
          hotels={hotels}
          roomsByHotel={roomsByHotel}
          users={users}
          onCreated={(created) =>
            finish(
              `대리 예약 #${created.reservationId}을(를) 만들었습니다 (${guestLabel(created.userId)}, ${created.checkInDate} ~ ${created.checkOutDate}). 손님 앱 결제 대기에 나타납니다.`,
            )
          }
          onClose={() => setIsCreating(false)}
        />
      )}

      {selected && (
        <AdminReservationActionPanel
          key={`${selected.booking.reservationId}-${selected.action}`}
          booking={selected.booking}
          action={selected.action}
          roomLabel={`${hotelName(selected.booking.hotelId)} · ${roomName(selected.booking.hotelId, selected.booking.roomId)}`}
          guestName={guestLabel(selected.booking.userId)}
          activeExtensions={selected.booking.linkedReservationId ? [] : extensionsOf(selected.booking)}
          nextExtension={extensionsOf(selected.booking).find(
            (e) => e.checkInDate === selected.booking.checkOutDate && e.reservationId !== selected.booking.reservationId,
          )}
          onDone={finish}
          onClose={() => setSelected(null)}
        />
      )}

      <div className="admin-card">
        <div className="admin-assign-filters">
          <label className="admin-form-row">
            <span>지점</span>
            <select
              value={hotelFilter}
              onChange={(e) => setHotelFilter(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">전체</option>
              {hotels.map((h) => (
                <option key={h.hotelId} value={h.hotelId}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-form-row">
            <span>상태</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.value || 'ALL'} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-form-row">
            <span>검색 (예약 번호·회원·호실)</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 12, 홍길동, 201" />
          </label>
          <div className="admin-assign-nav">
            <button type="button" className="admin-btn" onClick={() => setReloadKey((k) => k + 1)}>
              새로고침
            </button>
          </div>
        </div>
      </div>

      {loadError && <p className="admin-state is-error">{loadError}</p>}
      {!loadError && !bookings && <p className="admin-state">불러오는 중...</p>}

      {bookings && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>예약 목록 ({visible.length}건)</h2>
          </div>
          {visible.length === 0 ? (
            <p className="admin-state">조건에 맞는 예약이 없습니다.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>회원</th>
                    <th>지점 · 객실</th>
                    <th>투숙 기간</th>
                    <th>인원</th>
                    <th>금액</th>
                    <th>상태</th>
                    <th>호실</th>
                    <th>비고</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((b) => {
                    const isActive = ACTIVE_STATUSES.includes(b.status)
                    const isSelected = selected?.booking.reservationId === b.reservationId
                    return (
                      <tr key={b.reservationId} className={isSelected ? 'is-selected' : undefined}>
                        <td>#{b.reservationId}</td>
                        <td>{guestLabel(b.userId)}</td>
                        <td>
                          {hotelName(b.hotelId)} · {roomName(b.hotelId, b.roomId)}
                        </td>
                        <td>
                          {b.checkInDate} ~ {b.checkOutDate}
                        </td>
                        <td>{b.guestCount}명</td>
                        <td>{b.totalAmount.toLocaleString()}원</td>
                        <td>
                          <span className={statusBadgeClass(b.status)}>{STATUS_LABEL[b.status] ?? b.status}</span>
                        </td>
                        <td>{b.roomNumber ? `${b.roomNumber}호` : isActive ? '미배정' : '-'}</td>
                        <td className="admin-reservation-note">
                          {b.createdByAdminId && <span>대리 예약 ({b.createdByAdminName || '직원'})</span>}
                          {b.linkedReservationId && <span>#{b.linkedReservationId}의 연장</span>}
                          {b.cancelledByAdminId && <span>직원 취소: {b.cancelReason}</span>}
                        </td>
                        <td>
                          <div className="admin-unit-actions">
                            {b.status === 'RESERVED' && (
                              <button type="button" className="admin-btn" onClick={() => openAction(b, 'extend')}>
                                연장
                              </button>
                            )}
                            {isActive && (
                              <button
                                type="button"
                                className="admin-btn is-danger"
                                onClick={() => openAction(b, 'cancel')}
                              >
                                취소
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default AdminReservationsPage
