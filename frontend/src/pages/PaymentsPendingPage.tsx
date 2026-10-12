import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchMyBookings, isUnauthorized, refreshAccessToken, type Booking } from '../api/gateway'
import { toImageDataUrl } from '../api/hotels'
import type { Payment } from '../api/payments'
import PaymentModal from '../components/reservation/PaymentModal'
import PaymentCompleteModal from '../components/reservation/PaymentCompleteModal'
import { diffDays, formatDateWithWeekday, parseDateISO } from '../utils/date'
import { formatDate, fetchRoomLookup, type RoomWithHotel } from './reservationHistoryUtils'
import './MyPage.css'
import './ReservationHistoryPage.css'
import './PaymentsPendingPage.css'

// PaymentModal에 넘길 "체크인 - 체크아웃 · N박" 문자열. 날짜 파싱에 실패하면 기간 없이 보여준다.
function formatPeriod(checkInDate: string, checkOutDate: string): string | undefined {
  const checkIn = parseDateISO(checkInDate)
  const checkOut = parseDateISO(checkOutDate)
  if (!checkIn || !checkOut) return undefined
  return `${formatDateWithWeekday(checkIn)} - ${formatDateWithWeekday(checkOut)} · ${diffDays(checkOut, checkIn)}박`
}

// 마이페이지 > 결제 대기(/mypage/payments/pending). 예약 내역 중 결제 대기(PENDING_PAYMENT) 상태인
// 것만 골라 보여주고, 각 항목에서 바로 결제하거나(PaymentModal) 예약 상세로 이동할 수 있게 한다.
function PaymentsPendingPage() {
  const navigate = useNavigate()

  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryTick, setRetryTick] = useState(0)

  // roomId -> {hotel, room} 맵. ReservationHistoryPage와 동일한 이유로 필요하다 (fetchRoomLookup 주석 참고).
  const [roomLookup, setRoomLookup] = useState<Map<number, RoomWithHotel> | null>(null)

  const [payingBooking, setPayingBooking] = useState<Booking | null>(null)
  const [completedPayment, setCompletedPayment] = useState<Payment | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setLoadError('')
      try {
        const data = await fetchMyBookings()
        if (!cancelled) setBookings(data)
      } catch (err) {
        if (cancelled) return
        // fetchMyBookings()는 429 등을 이미 내부에서(요청 자체) 예산껏 재시도했다. 진짜 로그인이
        // 필요한 상태(401)가 아니면 재발급을 또 시도하지 않는다 — 안 그러면 이미 몰린 요청에
        // 부하만 배가된다.
        if (!isUnauthorized(err)) {
          setLoadError('일시적으로 결제 대기 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다.
        try {
          await refreshAccessToken()
          const data = await fetchMyBookings()
          if (!cancelled) setBookings(data)
        } catch (err2) {
          if (cancelled) return
          if (isUnauthorized(err2)) {
            navigate('/login')
          } else {
            setLoadError('일시적으로 결제 대기 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate, retryTick])

  useEffect(() => {
    let cancelled = false

    fetchRoomLookup()
      .then((lookup) => {
        if (!cancelled) setRoomLookup(lookup)
      })
      .catch(() => {
        if (!cancelled) setRoomLookup(new Map())
      })

    return () => {
      cancelled = true
    }
  }, [])

  const pendingBookings = bookings?.filter((booking) => booking.status === 'PENDING_PAYMENT') ?? null

  // 결제가 끝나면 이 페이지가 보여주는 목록(PENDING_PAYMENT만)에서 자연히 빠지므로 예약 상태를
  // 굳이 갱신하지 않고 목록에서 제거하기만 한다. 결제완료 모달은 확인 시 /payments로 보낸다.
  const handlePaid = (payment: Payment) => {
    const paidReservationId = payingBooking?.reservationId
    setBookings((prev) => prev?.filter((booking) => booking.reservationId !== paidReservationId) ?? prev)
    setPayingBooking(null)
    setCompletedPayment(payment)
  }

  return (
    <section className="mypage-page">
      <div className="mypage-content">
        <div className="mypage-section">
          <div className="mypage-section-header">
            <h1 className="mypage-title">결제 대기</h1>
          </div>

          {isLoading && <p className="mypage-status">불러오는 중...</p>}

          {!isLoading && loadError && (
            <div className="mypage-status">
              <p className="mypage-error">{loadError}</p>
              <button type="button" className="mypage-ghost-btn" onClick={() => setRetryTick((t) => t + 1)}>
                다시 시도
              </button>
            </div>
          )}

          {!isLoading && pendingBookings && pendingBookings.length === 0 && (
            <p className="mypage-status">결제 대기 중인 예약이 없습니다.</p>
          )}

          {!isLoading && pendingBookings && pendingBookings.length > 0 && (
            <ul className="reservation-list">
              {pendingBookings.map((booking) => {
                const roomInfo = roomLookup?.get(booking.roomId)
                const checkIn = parseDateISO(booking.checkInDate)
                const checkOut = parseDateISO(booking.checkOutDate)
                const nights = checkIn && checkOut ? diffDays(checkOut, checkIn) : null
                const thumbnail = roomInfo?.room.images[0]

                return (
                  <li className="reservation-card" key={booking.reservationId}>
                    <div className="payments-pending-card">
                      <div className="reservation-card-header">
                        <span className="reservation-status reservation-status-pending_payment">결제 대기</span>
                        <span className="reservation-id">예약번호 {booking.reservationId}</span>
                      </div>

                      <div className="reservation-card-body">
                        {thumbnail ? (
                          <img
                            className="reservation-card-thumb"
                            src={toImageDataUrl(thumbnail)}
                            alt={roomInfo?.room.name}
                          />
                        ) : (
                          <div
                            className="reservation-card-thumb is-placeholder"
                            style={roomInfo ? { background: roomInfo.hotel.accent } : undefined}
                            aria-hidden="true"
                          />
                        )}

                        <div className="reservation-card-info">
                          <p className="reservation-card-hotel">
                            {roomInfo ? `${roomInfo.hotel.name} · ${roomInfo.hotel.location}` : `객실 #${booking.roomId}`}
                          </p>
                          <p className="reservation-card-room">{roomInfo?.room.name ?? '객실 정보를 불러오는 중...'}</p>
                          <p className="reservation-card-meta">
                            {formatDate(booking.checkInDate)} ~ {formatDate(booking.checkOutDate)}
                            {nights != null && ` · ${nights}박`} · {booking.guestCount}명
                          </p>
                        </div>

                        <span className="reservation-card-amount">{booking.totalAmount.toLocaleString()}원</span>

                        <div className="payments-pending-card-actions">
                          <button
                            type="button"
                            className="mypage-ghost-btn"
                            onClick={() => navigate(`/mypage/reservations/${booking.reservationId}`, { state: { booking } })}
                          >
                            상세보기
                          </button>
                          <button type="button" className="mypage-submit" onClick={() => setPayingBooking(booking)}>
                            결제하기
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {payingBooking && (
        <PaymentModal
          reservationId={payingBooking.reservationId}
          summary={{
            roomName: roomLookup?.get(payingBooking.roomId)?.room.name ?? `객실 #${payingBooking.roomId}`,
            hotelName: roomLookup?.get(payingBooking.roomId)?.hotel.name,
            period: formatPeriod(payingBooking.checkInDate, payingBooking.checkOutDate),
            amount: payingBooking.totalAmount,
          }}
          onClose={() => setPayingBooking(null)}
          onPaid={handlePaid}
        />
      )}

      {completedPayment && (
        <PaymentCompleteModal payment={completedPayment} onClose={() => setCompletedPayment(null)} />
      )}
    </section>
  )
}

export default PaymentsPendingPage
