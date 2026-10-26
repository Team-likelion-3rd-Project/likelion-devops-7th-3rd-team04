import { useEffect, useMemo, useState } from 'react'
import { fetchAdminHotelRooms, fetchAdminHotels } from '../../api/adminApi'
import type { AdminHotel, AdminRoom } from '../../api/adminApi'
import {
  adminReservationErrorMessage,
  fetchAdminBookings,
  fetchAdminUserPayments,
  fetchLinkedBookings,
  latestPaymentByReservation,
} from '../../api/adminReservations'
import type { AdminBooking } from '../../api/adminReservations'
import type { Payment } from '../../api/payments'
import { STATUS_LABEL } from '../../pages/reservationHistoryUtils'
import { PAYMENT_STATUS_LABEL } from '../../utils/payment'
import AdminPagination from '../components/AdminPagination'
import AdminProxyBookingForm from '../components/AdminProxyBookingForm'
import AdminReservationActionPanel from '../components/AdminReservationActionPanel'
import type { ReservationAction } from '../components/AdminReservationActionPanel'
import './AdminPages.css'

// 직원이 처리할 수 있는(취소·연장 대상이 되는) 진행 중 예약 상태
const ACTIVE_STATUSES = ['PENDING_PAYMENT', 'RESERVED']

// 한 페이지에 보여 줄 예약 수 (서버 기본 20)
const PAGE_SIZE = 20

// 상태 고르기 → 서버 status 조건 ("진행 중"은 두 상태, "전체"는 조건 없음)
function statusQuery(filter: string): string[] | undefined {
  if (filter === 'ACTIVE') return ACTIVE_STATUSES
  return filter ? [filter] : undefined
}

// "이름 (이메일)" — 목록 응답의 guestName·guestEmail(LDP-150). 탈퇴 회원 등 이름이 없으면 회원 번호
function guestLabel(booking: Pick<AdminBooking, 'userId' | 'guestName' | 'guestEmail'>): string {
  if (!booking.guestName) return `회원 #${booking.userId}`
  return booking.guestEmail ? `${booking.guestName} (${booking.guestEmail})` : booking.guestName
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'ACTIVE', label: '진행 중 (결제 대기·예약 확정)' },
  { value: '', label: '전체' },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

// 사람이 확인해야 하는 결제 상태 — 관리자 알림이 없어서(10-22 결정) 이 화면이 직원이 발견하는 통로다
const MANUAL_PAYMENT_STATUSES = ['refund_manual_required', 'unknown_manual_required']

function paymentBadgeClass(statusKey: string): string {
  if (MANUAL_PAYMENT_STATUSES.includes(statusKey) || statusKey === 'failed') return 'admin-badge is-bad'
  if (statusKey === 'approved') return 'admin-badge is-good'
  if (statusKey === 'refunded') return 'admin-badge'
  return 'admin-badge is-warn'
}

function statusBadgeClass(status: string): string {
  if (status === 'RESERVED' || status === 'COMPLETED') return 'admin-badge is-good'
  if (status === 'PENDING_PAYMENT') return 'admin-badge is-warn'
  return 'admin-badge is-bad'
}

// 예약 관리: 예약 목록 + 대리 예약 만들기 + 직원 취소 + 투숙 연장 (LDP-118 #224, API: LDP-90 #204).
// 지점·상태·검색어는 서버 조건으로 보내고 한 페이지(20건)씩 받는다 (LDP-152, API: LDP-136 #287).
function AdminReservationsPage() {
  const [result, setResult] = useState<{ bookings: AdminBooking[]; total: number } | null>(null)
  const [hotels, setHotels] = useState<AdminHotel[]>([])
  const [roomsByHotel, setRoomsByHotel] = useState<Map<number, AdminRoom[]>>(new Map())
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [hotelFilter, setHotelFilter] = useState<number | ''>('')
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [query, setQuery] = useState('')
  // 검색어는 입력이 멈추고 0.3초 뒤에 서버로 보낸다
  const [searchKeyword, setSearchKeyword] = useState('')
  const [page, setPage] = useState(1)

  // 조건이 바뀌면 1페이지부터
  const changeFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchKeyword(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const [isCreating, setIsCreating] = useState(false)
  const [selected, setSelected] = useState<{ booking: AdminBooking; action: ReservationAction } | null>(null)
  const [notice, setNotice] = useState('')
  // 예약 번호 → 그 예약의 가장 최근 결제. 화면에 보이는 예약의 회원별로 불러온다 (못 불러온 회원은 비워 둔다)
  const [paymentsByReservation, setPaymentsByReservation] = useState<Map<number, Payment>>(new Map())

  // 지점·객실 종류는 처음 한 번만 불러온다 (이름 표시·대리 예약 폼용). 예약자 이름은 목록 응답에 들어 있다
  useEffect(() => {
    let ignore = false
    fetchAdminHotels()
      .then(async (hotelList) => {
        const roomLists = await Promise.all(hotelList.map((h) => fetchAdminHotelRooms(h.hotelId).catch(() => [])))
        if (ignore) return
        setHotels(hotelList)
        setRoomsByHotel(new Map(hotelList.map((h, i) => [h.hotelId, roomLists[i]])))
      })
      .catch((err) => {
        if (!ignore) setLoadError(err instanceof Error ? err.message : '지점 정보를 불러오지 못했습니다.')
      })
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false
    fetchAdminBookings({
      page,
      size: PAGE_SIZE,
      hotelId: hotelFilter === '' ? undefined : hotelFilter,
      status: statusQuery(statusFilter),
      keyword: searchKeyword,
    })
      .then((data) => {
        if (ignore) return
        setResult(data)
        setLoadError('')
      })
      .catch((err) => {
        if (!ignore) setLoadError(adminReservationErrorMessage(err, '예약 목록을 불러오지 못했습니다.'))
      })
    return () => {
      ignore = true
    }
  }, [page, hotelFilter, statusFilter, searchKeyword, reloadKey])

  const hotelName = (id: number) => hotels.find((h) => h.hotelId === id)?.name ?? `지점 ${id}`
  const roomName = (hotelId: number, roomId: number) =>
    roomsByHotel.get(hotelId)?.find((r) => r.roomId === roomId)?.name ?? `객실 ${roomId}`
  // 지금 페이지의 예약 (서버가 조건·최신순으로 내려준다)
  const visible = useMemo(() => result?.bookings ?? [], [result])
  const total = result?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // 검색어를 칠 때마다 다시 부르지 않게, 화면에 보이는 회원 묶음이 바뀌거나 새로고침할 때만 결제를 불러온다
  const visibleUserKey = useMemo(() => [...new Set(visible.map((b) => b.userId))].sort((a, b) => a - b).join(','), [visible])

  useEffect(() => {
    const userIds = visibleUserKey ? visibleUserKey.split(',').map(Number) : []
    if (userIds.length === 0) return
    let ignore = false
    Promise.allSettled(userIds.map((id) => fetchAdminUserPayments(id))).then((results) => {
      if (ignore) return
      const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      setPaymentsByReservation(latestPaymentByReservation(all))
    })
    return () => {
      ignore = true
    }
  }, [visibleUserKey, reloadKey])

  const needsCheck = visible.filter((b) => {
    const p = paymentsByReservation.get(b.reservationId)
    return p && MANUAL_PAYMENT_STATUSES.includes(p.status.toLowerCase())
  })

  // 연장 묶음: linkedReservationId = 맨 처음 원래 예약. 원래 예약을 취소하면 진행 중인 연장 예약도 함께 취소되고,
  // 연장의 연장은 가장 최근 연장 예약에서 요청해야 한다. 연장 예약이 다른 페이지에 있을 수 있어 패널을 열 때 묶음을 따로 조회한다.
  // linked: null = 조회 중, 조회 실패면 지금 페이지 예약으로 대신 판단한다
  const [linked, setLinked] = useState<{ bookings: AdminBooking[]; fromPageOnly: boolean } | null>(null)

  const extensionsOf = (booking: AdminBooking, group: AdminBooking[]) => {
    const rootId = booking.linkedReservationId ?? booking.reservationId
    return group.filter((b) => b.linkedReservationId === rootId && ACTIVE_STATUSES.includes(b.status))
  }

  const openAction = (booking: AdminBooking, action: ReservationAction) => {
    setIsCreating(false)
    setNotice('')
    setSelected({ booking, action })
    setLinked(null)
    fetchLinkedBookings(booking.linkedReservationId ?? booking.reservationId)
      .then((group) => setLinked({ bookings: group, fromPageOnly: false }))
      .catch(() => setLinked({ bookings: visible, fromPageOnly: true }))
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

      {needsCheck.length > 0 && (
        <p className="admin-state is-error">
          ⚠ 결제·환불을 직원이 확인해야 하는 예약이 {needsCheck.length}건 있습니다:{' '}
          {needsCheck.map((b) => `#${b.reservationId}`).join(', ')} — 토스 상점관리자에서 결제·환불 결과를 확인해 주세요.
        </p>
      )}

      {isCreating && (
        <AdminProxyBookingForm
          hotels={hotels}
          roomsByHotel={roomsByHotel}
          onCreated={(created, guest) =>
            finish(
              `대리 예약 #${created.reservationId}을(를) 만들었습니다 (${guest}, ${created.checkInDate} ~ ${created.checkOutDate}). 손님 앱 결제 대기에 나타납니다.`,
            )
          }
          onClose={() => setIsCreating(false)}
        />
      )}

      {selected && !linked && <p className="admin-state">연장 예약 묶음을 확인하는 중...</p>}
      {selected && linked?.fromPageOnly && (
        <p className="admin-state is-error">
          연장 예약 묶음을 불러오지 못해 이 페이지의 예약만으로 판단합니다. 다른 페이지의 연장 예약은 반영되지 않을 수 있습니다.
        </p>
      )}
      {selected && linked && (
        <AdminReservationActionPanel
          key={`${selected.booking.reservationId}-${selected.action}`}
          booking={selected.booking}
          action={selected.action}
          roomLabel={`${hotelName(selected.booking.hotelId)} · ${roomName(selected.booking.hotelId, selected.booking.roomId)}`}
          guestName={guestLabel(selected.booking)}
          payment={paymentsByReservation.get(selected.booking.reservationId)}
          activeExtensions={selected.booking.linkedReservationId ? [] : extensionsOf(selected.booking, linked.bookings)}
          nextExtension={extensionsOf(selected.booking, linked.bookings).find(
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
              onChange={(e) => changeFilter(() => setHotelFilter(e.target.value === '' ? '' : Number(e.target.value)))}
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
            <select value={statusFilter} onChange={(e) => changeFilter(() => setStatusFilter(e.target.value))}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.value || 'ALL'} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-form-row">
            <span>검색 (예약 번호·회원·호실)</span>
            <input
              value={query}
              onChange={(e) => changeFilter(() => setQuery(e.target.value))}
              placeholder="예: 12, 홍길동, 201"
            />
          </label>
          <div className="admin-assign-nav">
            <button type="button" className="admin-btn" onClick={() => setReloadKey((k) => k + 1)}>
              새로고침
            </button>
          </div>
        </div>
      </div>

      {loadError && <p className="admin-state is-error">{loadError}</p>}
      {!loadError && !result && <p className="admin-state">불러오는 중...</p>}

      {result && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>
              예약 목록 (전체 {total.toLocaleString()}건 · {page}/{lastPage}페이지)
            </h2>
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
                    <th>결제</th>
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
                        <td>{guestLabel(b)}</td>
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
                        <td>
                          {(() => {
                            const payment = paymentsByReservation.get(b.reservationId)
                            if (!payment) return '-'
                            const key = payment.status.toLowerCase()
                            return <span className={paymentBadgeClass(key)}>{PAYMENT_STATUS_LABEL[key] ?? payment.status}</span>
                          })()}
                        </td>
                        <td>{b.roomNumber ? `${b.roomNumber}호` : isActive ? '미배정' : '-'}</td>
                        <td className="admin-reservation-note">
                          {b.createdByAdminId && <span>대리 예약 ({b.createdByAdminName || '직원'})</span>}
                          {b.linkedReservationId && <span>#{b.linkedReservationId}의 연장</span>}
                          {b.cancelledByAdminId && <span>직원 취소: {b.cancelReason}</span>}
                        </td>
                        <td>
                          {/* 버튼 자리를 두 칸으로 고정 — 연장이 없는 줄도 취소가 같은 세로줄에 오게 빈칸을 둔다 */}
                          <div className="admin-reservation-actions">
                            {b.status === 'RESERVED' ? (
                              <button type="button" className="admin-btn" onClick={() => openAction(b, 'extend')}>
                                연장
                              </button>
                            ) : (
                              <span aria-hidden="true" />
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
          <AdminPagination page={page} lastPage={lastPage} onChange={setPage} label="예약 목록 페이지" />
        </div>
      )}
    </section>
  )
}

export default AdminReservationsPage
