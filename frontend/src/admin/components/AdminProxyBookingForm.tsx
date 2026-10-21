import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { AdminHotel, AdminRoom, AdminUser } from '../../api/adminApi'
import { adminReservationErrorMessage, createAdminBooking } from '../../api/adminReservations'
import type { AdminBooking } from '../../api/adminReservations'

interface AdminProxyBookingFormProps {
  hotels: AdminHotel[]
  roomsByHotel: Map<number, AdminRoom[]>
  users: AdminUser[]
  onCreated: (booking: AdminBooking) => void
  onClose: () => void
}

// 대리 예약 만들기 (POST /api/bookings/admin, LDP-90). 전화·방문 손님 대신 직원이 회원 명의로 예약한다.
// 만든 예약은 손님 앱 "결제 대기"에 나타나고, 손님이 결제해야 확정된다(결제 마감 = 만든 날 밤 자정).
function AdminProxyBookingForm({ hotels, roomsByHotel, users, onCreated, onClose }: AdminProxyBookingFormProps) {
  const [userQuery, setUserQuery] = useState('')
  const [userId, setUserId] = useState<number | ''>('')
  const [hotelId, setHotelId] = useState<number | ''>(hotels[0]?.hotelId ?? '')
  const [roomId, setRoomId] = useState<number | ''>('')
  const [checkInDate, setCheckInDate] = useState('')
  const [checkOutDate, setCheckOutDate] = useState('')
  const [guestCount, setGuestCount] = useState('2')
  const [poolGuestCount, setPoolGuestCount] = useState('0')
  const [loungeGuestCount, setLoungeGuestCount] = useState('0')
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // 탈퇴·정지 회원은 빼고, 이름·이메일·전화번호로 찾는다
  const matchedUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    return users
      .filter((u) => u.status === 'ACTIVE')
      .filter((u) => !q || [u.name, u.email, u.phoneNumber].some((v) => v?.toLowerCase().includes(q)))
      .slice(0, 50)
  }, [users, userQuery])

  const rooms = hotelId === '' ? [] : (roomsByHotel.get(hotelId) ?? [])
  const selectedRoom = rooms.find((r) => r.roomId === roomId)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const guests = Number(guestCount)
    const pool = Number(poolGuestCount || 0)
    const lounge = Number(loungeGuestCount || 0)
    if (userId === '' || hotelId === '' || roomId === '') {
      setFormError('회원, 지점, 객실 종류를 골라 주세요.')
      return
    }
    if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
      setFormError('체크인·체크아웃 날짜를 확인해 주세요. 체크아웃은 체크인보다 뒤여야 합니다.')
      return
    }
    if (!Number.isInteger(guests) || guests < 1 || (selectedRoom && guests > selectedRoom.capacity)) {
      setFormError(`투숙 인원은 1~${selectedRoom?.capacity ?? ''}명으로 입력해 주세요.`)
      return
    }
    if (![pool, lounge].every((n) => Number.isInteger(n) && n >= 0 && n <= guests)) {
      setFormError('수영장·라운지 인원은 0 이상, 투숙 인원 이하로 입력해 주세요.')
      return
    }

    setIsSaving(true)
    setFormError('')
    try {
      const created = await createAdminBooking({
        userId,
        hotelId,
        roomId,
        checkInDate,
        checkOutDate,
        guestCount: guests,
        poolGuestCount: pool || undefined,
        loungeGuestCount: lounge || undefined,
      })
      onCreated(created)
    } catch (err) {
      setFormError(adminReservationErrorMessage(err, '대리 예약을 만들지 못했습니다.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="admin-card admin-assign-panel">
      <div className="admin-card-header">
        <h2>대리 예약 만들기</h2>
        <div className="admin-card-header-actions">
          <button type="button" className="admin-btn" onClick={onClose} disabled={isSaving}>
            닫기
          </button>
        </div>
      </div>
      <p className="admin-stat-note">
        회원 명의로 예약을 만듭니다. 손님 앱의 결제 대기에 나타나고, 손님이 결제해야 확정됩니다 (결제 마감: 오늘 밤 자정).
      </p>

      <form className="admin-form" onSubmit={handleSubmit} noValidate>
        <div className="admin-assign-filters">
          <label className="admin-form-row">
            <span>회원 검색 (이름·이메일·전화번호)</span>
            <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="예: 홍길동" />
          </label>
          <label className="admin-form-row">
            <span>회원</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">{matchedUsers.length > 0 ? '회원 선택' : '검색 결과가 없습니다'}</option>
              {matchedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="admin-assign-filters">
          <label className="admin-form-row">
            <span>지점</span>
            <select
              value={hotelId}
              onChange={(e) => {
                setHotelId(e.target.value === '' ? '' : Number(e.target.value))
                setRoomId('')
              }}
            >
              {hotels.map((h) => (
                <option key={h.hotelId} value={h.hotelId}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-form-row">
            <span>객실 종류</span>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">객실 종류 선택</option>
              {rooms.map((r) => (
                <option key={r.roomId} value={r.roomId}>
                  {r.name} (최대 {r.capacity}명)
                </option>
              ))}
            </select>
          </label>
          <label className="admin-form-row">
            <span>체크인</span>
            <input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} />
          </label>
          <label className="admin-form-row">
            <span>체크아웃</span>
            <input
              type="date"
              value={checkOutDate}
              min={checkInDate || undefined}
              onChange={(e) => setCheckOutDate(e.target.value)}
            />
          </label>
        </div>

        <div className="admin-assign-filters">
          <label className="admin-form-row">
            <span>투숙 인원</span>
            <input
              type="number"
              min={1}
              max={selectedRoom?.capacity}
              value={guestCount}
              onChange={(e) => setGuestCount(e.target.value)}
            />
          </label>
          <label className="admin-form-row">
            <span>수영장 인원 (선택)</span>
            <input type="number" min={0} value={poolGuestCount} onChange={(e) => setPoolGuestCount(e.target.value)} />
          </label>
          <label className="admin-form-row">
            <span>라운지 인원 (선택)</span>
            <input
              type="number"
              min={0}
              value={loungeGuestCount}
              onChange={(e) => setLoungeGuestCount(e.target.value)}
            />
          </label>
        </div>

        {formError && <p className="admin-form-error">{formError}</p>}
        <div className="admin-form-actions">
          <button type="submit" className="admin-btn is-primary" disabled={isSaving}>
            {isSaving ? '예약 만드는 중...' : '대리 예약 만들기'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default AdminProxyBookingForm
