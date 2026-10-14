import { Fragment, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { HOTELS } from '../data/hotels'
import type { Hotel } from '../data/hotels'
import { fetchRoom, toImageDataUrl } from '../api/hotels'
import type { Room } from '../api/hotels'
import { fetchMyBookings, fetchReservationFacilities } from '../api/bookings'
import type { Booking, ReservationFacility } from '../api/bookings'
import { isUnauthorized, refreshAccessToken } from '../api/gateway'
import { customerAuth } from '../api/tokenStore'
import ReservationSteps from '../components/reservation/ReservationSteps'
import { sumGuests } from '../components/reservation/guestTypes'
import type { RoomGuests } from '../components/reservation/guestTypes'
import { CalendarIcon, CheckIcon, PersonIcon, PinIcon } from '../components/reservation/icons'
import PaymentModal from '../components/reservation/PaymentModal'
import { diffDays, formatDateWithWeekday, parseDateISO } from '../utils/date'
import './ReservationCompletePage.css'

type LoadStatus = 'loading' | 'success' | 'error'

// ReservationOptionsPage에서 결제 성공 직후 navigate(state: ...)로 실어 보내는 값.
// 여기 담긴 정보만으로 바로 렌더링하면 되므로, 새로고침/직접 접근이 아닌 이상 추가 API 호출이 없다.
interface CompleteLocationState {
  booking?: Booking
  hotel?: Hotel
  room?: Room
  guestRooms?: RoomGuests[]
}

function ReservationCompletePage() {
  const { reservationId: reservationIdRaw } = useParams()
  const reservationId = reservationIdRaw ? Number(reservationIdRaw) : null
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state as CompleteLocationState | null) ?? {}
  const user = customerAuth.useUser()

  const [booking, setBooking] = useState<Booking | null>(
    state.booking && state.booking.reservationId === reservationId ? state.booking : null,
  )
  const [hotel, setHotel] = useState<Hotel | null>(state.hotel ?? null)
  const [room, setRoom] = useState<Room | null>(state.room ?? null)
  const [status, setStatus] = useState<LoadStatus>(booking ? 'success' : 'loading')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [facilities, setFacilities] = useState<ReservationFacility[]>([])

  // reservationId 자체가 없으면(예: 페이지 직접 잘못 접근) 예약 플로우 처음으로 돌려보낸다.
  useEffect(() => {
    if (!reservationId) {
      navigate('/reservation', { replace: true })
    }
  }, [reservationId, navigate])

  // state로 예약 정보가 전달되지 않은 경우(새로고침, 북마크/직접 접근 등) — 로그인한 사용자 본인의
  // 예약 목록에서 reservationId로 다시 찾아온다. 단건 조회 API가 없어 목록 조회로 대체한다.
  useEffect(() => {
    if (booking || !reservationId) return

    let cancelled = false

    const applyFound = async (bookings: Booking[]) => {
      const found = bookings.find((b) => b.reservationId === reservationId)
      if (!found) {
        if (!cancelled) setStatus('error')
        return
      }
      if (cancelled) return
      setBooking(found)

      // Booking 응답엔 roomId만 있고 hotelId가 없어, 등록된 호텔들을 순서대로 시도해 소속 호텔/객실을 찾는다.
      for (const h of HOTELS) {
        try {
          const r = await fetchRoom(h.hotelId, found.roomId)
          if (cancelled) return
          setHotel(h)
          setRoom(r)
          break
        } catch {
          // 이 호텔 소속 객실이 아님 — 다음 호텔로 계속 시도
        }
      }
      if (!cancelled) setStatus('success')
    }

    fetchMyBookings()
      .then(applyFound)
      .catch(async (err) => {
        // fetchMyBookings()는 429 등을 이미 내부에서 예산껏 재시도했다. 진짜 401이 아니면 재발급을
        // 또 시도하지 않는다 — 안 그러면 이미 몰린 요청에 부하만 배가된다.
        if (!isUnauthorized(err)) {
          if (!cancelled) setStatus('error')
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다.
        try {
          await refreshAccessToken()
          const bookings = await fetchMyBookings()
          if (cancelled) return
          await applyFound(bookings)
        } catch {
          if (!cancelled) setStatus('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [booking, reservationId])

  // 편의시설(수영장/라운지 등) 이용 내역은 Booking 응답에 없으므로 별도로 조회한다.
  // booking이 location.state(새로고침에도 브라우저가 history state를 들고 있으면 유지됨)에서
  // 바로 복원된 경우, 위 booking 조회 effect는 아예 실행되지 않아 액세스 토큰이 메모리에 복구되지
  // 않은 채로 이 요청이 나갈 수 있다 — 그래서 이 effect 자체에도 동일한 재시도 로직을 둔다.
  useEffect(() => {
    if (!booking) return
    let cancelled = false

    const load = async () => {
      try {
        const data = await fetchReservationFacilities(booking.reservationId)
        if (!cancelled) setFacilities(data)
      } catch (err) {
        // fetchReservationFacilities()는 429 등을 이미 내부에서 예산껏 재시도했다. 진짜 401이
        // 아니면 재발급을 또 시도하지 않는다 — 이 정보는 참고용이라 실패해도 조용히 비워둔다.
        if (!isUnauthorized(err)) {
          if (!cancelled) setFacilities([])
          return
        }
        try {
          await refreshAccessToken()
          const data = await fetchReservationFacilities(booking.reservationId)
          if (!cancelled) setFacilities(data)
        } catch {
          if (!cancelled) setFacilities([])
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [booking])

  if (!reservationId) {
    // useEffect가 /reservation으로 돌려보내는 동안 잠깐 보여줄 빈 화면
    return null
  }

  const checkIn = booking ? parseDateISO(booking.checkInDate) : null
  const checkOut = booking ? parseDateISO(booking.checkOutDate) : null
  const nights = checkIn && checkOut ? diffDays(checkOut, checkIn) : null
  const guests = state.guestRooms ? sumGuests(state.guestRooms) : null

  const selectedOptionLabels = facilities.map((f) => `${f.facilityName} ${f.guestCount}인`)
  const hasPoolFacility = facilities.some((f) => f.facilityName === '수영장')
  const hasLoungeFacility = facilities.some((f) => f.facilityName === '라운지')

  const thumbnail = room?.images[0]
  const greetingName = user ? `${user.name}님, ` : ''
  const greetingHotel = hotel ? `${hotel.name} ` : ''

  return (
    <section className="reservation-complete-page">
      <div className="reservation-page-header">
        <h1>객실예약</h1>
        <ReservationSteps activeStep={3} />
      </div>

      {status === 'loading' && <p className="reservation-complete-status">예약 정보를 불러오는 중입니다…</p>}

      {status === 'error' && (
        <div className="reservation-complete-status error">
          <p>예약 정보를 불러오지 못했습니다.</p>
          <Link to="/mypage/reservations">내 예약 내역에서 확인하기</Link>
        </div>
      )}

      {status === 'success' && booking && (
        <>
          <div className="reservation-complete-banner">
            <span className="reservation-complete-check" aria-hidden="true">
              <CheckIcon />
            </span>
            <h2>
              {greetingName}
              {greetingHotel}예약이 확정되었습니다
            </h2>
            <p className="reservation-complete-number">예약번호 {booking.reservationId}</p>
          </div>

          <div className="reservation-complete-body">
            <div className="reservation-complete-main">
              <div className="reservation-complete-room">
                {thumbnail ? (
                  <img className="reservation-complete-room-thumb" src={toImageDataUrl(thumbnail)} alt={room?.name} />
                ) : (
                  <div className="reservation-complete-room-thumb is-placeholder" aria-hidden="true" />
                )}
                <div className="reservation-complete-room-info">
                  <h3>{room ? room.name : `객실 #${booking.roomId}`}</h3>
                  {room && <p>기준 인원 {room.capacity}명</p>}
                </div>
              </div>

              <div className="reservation-complete-details">
                <div className="reservation-complete-row">
                  <span className="reservation-complete-label">
                    <PinIcon /> 호텔/지역
                  </span>
                  <span className="reservation-complete-value">
                    {hotel ? `${hotel.name} · ${hotel.location}` : '정보를 찾을 수 없습니다'}
                  </span>
                </div>

                <div className="reservation-complete-row">
                  <span className="reservation-complete-label">
                    <CalendarIcon /> 체크인/체크아웃
                  </span>
                  <span className="reservation-complete-value">
                    {checkIn && checkOut
                      ? `${formatDateWithWeekday(checkIn)} - ${formatDateWithWeekday(checkOut)}${
                          nights != null ? ` · ${nights}박` : ''
                        }`
                      : '정보를 찾을 수 없습니다'}
                  </span>
                </div>

                <div className="reservation-complete-row">
                  <span className="reservation-complete-label">
                    <PersonIcon /> 투숙인원
                  </span>
                  <span className="reservation-complete-value">
                    {guests
                      ? `총인원 ${guests.adults + guests.children + guests.infants} · 성인 ${guests.adults}, 어린이 ${guests.children}, 유아 ${guests.infants}`
                      : `총 ${booking.guestCount}명`}
                  </span>
                </div>

                <div className="reservation-complete-row">
                  <span className="reservation-complete-label">선택한 옵션</span>
                  <span className="reservation-complete-value">
                    {selectedOptionLabels.length > 0
                      ? selectedOptionLabels.map((label, index) => (
                          <Fragment key={label}>
                            {index > 0 && <br />}
                            {label}
                          </Fragment>
                        ))
                      : '선택한 옵션 없음'}
                  </span>
                </div>

                <div className="reservation-complete-row">
                  <span className="reservation-complete-label">예약 상태</span>
                  <span className="reservation-complete-value">{booking.status}</span>
                </div>
              </div>

              <div className="reservation-complete-notice">
                <p className="reservation-complete-notice-title">이용 안내</p>
                <ul>
                  <li>예약 확인 및 취소는 마이페이지의 예약 내역에서 하실 수 있습니다.</li>
                  <li>현재 결제 연동 전이라, 별도 결제 없이 예약만 생성된 상태입니다.</li>
                  {selectedOptionLabels.length > 0 && (
                    <li>선택하신 옵션은 체크인 시 프런트에서 이용권으로 교환해 드립니다.</li>
                  )}
                  {hasPoolFacility && (
                    <li>수영장 이용 시 수영모 착용은 필수이며, 만 12세 이하 어린이는 보호자 동반 하에 이용 가능합니다.</li>
                  )}
                  {hasLoungeFacility && (
                    <li>라운지 내 취식은 지정된 좌석에서만 가능하며, 외부 음식 반입은 제한됩니다.</li>
                  )}
                  <li>기타 문의사항은 프런트 데스크(02-0000-0000)로 연락해 주세요.</li>
                </ul>
              </div>
            </div>

            <aside className="reservation-complete-summary">
              <div className="reservation-complete-total">
                <span className="reservation-complete-total-label">
                  결제 금액
                  <br />
                  <span className="reservation-complete-total-note">부가가치세 포함</span>
                </span>
                <strong>{booking.totalAmount.toLocaleString()}원</strong>
              </div>

              <div className="reservation-complete-actions">
                {booking.status === 'PENDING_PAYMENT' && (
                  <button
                    type="button"
                    className="reservation-complete-primary"
                    onClick={() => setShowPaymentModal(true)}
                  >
                    결제하기
                  </button>
                )}
                <Link
                  className={
                    booking.status === 'PENDING_PAYMENT' ? 'reservation-complete-secondary' : 'reservation-complete-primary'
                  }
                  to="/mypage/reservations"
                >
                  예약 내역 보기
                </Link>
                <Link className="reservation-complete-secondary" to="/">
                  홈으로
                </Link>
              </div>
            </aside>
          </div>

          {showPaymentModal && (
            <PaymentModal
              reservationId={booking.reservationId}
              summary={{
                roomName: room ? room.name : `객실 #${booking.roomId}`,
                hotelName: hotel?.name,
                period:
                  checkIn && checkOut
                    ? `${formatDateWithWeekday(checkIn)} - ${formatDateWithWeekday(checkOut)}${
                        nights != null ? ` · ${nights}박` : ''
                      }`
                    : undefined,
                amount: booking.totalAmount,
              }}
              onClose={() => setShowPaymentModal(false)}
            />
          )}
        </>
      )}
    </section>
  )
}

export default ReservationCompletePage
