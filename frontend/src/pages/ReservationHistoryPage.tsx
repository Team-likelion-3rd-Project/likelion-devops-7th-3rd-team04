import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchMyBookings, isUnauthorized, refreshAccessToken, type Booking } from '../api/gateway'
import { toImageDataUrl } from '../api/hotels'
import { diffDays, parseDateISO } from '../utils/date'
import { STATUS_LABEL, formatDate, fetchRoomLookup, type RoomWithHotel } from './reservationHistoryUtils'
import { currentLoginState } from '../utils/loginRedirect'
import './MyPage.css'
import './ReservationHistoryPage.css'

// "예약하기"(ReservationPage, /reservation)와는 다른 페이지: 로그인한 사용자 본인의 지난 예약 목록을 보여준다.
// 목록에는 요약 정보만 보여주고, 상세 정보는 클릭 시 이동하는 ReservationDetailPage(/mypage/reservations/:reservationId)에서 보여준다.
function ReservationHistoryPage() {
  const navigate = useNavigate()

  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryTick, setRetryTick] = useState(0)

  // roomId -> {hotel, room} 맵. 어느 호텔/객실인지 예약 데이터만으로는 알 수 없어 목록 진입 시
  // 한 번에 조회해두고, 카드마다 booking.roomId로 찾아 쓴다.
  const [roomLookup, setRoomLookup] = useState<Map<number, RoomWithHotel> | null>(null)

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
          setLoadError('일시적으로 예약 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
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
            navigate('/login', { state: currentLoginState() })
          } else {
            setLoadError('일시적으로 예약 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
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

  return (
    <section className="mypage-page">
      <div className="mypage-content">
        <div className="mypage-section">
          <div className="mypage-section-header">
            <h1 className="mypage-title">내 예약 내역</h1>
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

          {!isLoading && bookings && bookings.length === 0 && (
            <p className="mypage-status">아직 예약 내역이 없습니다.</p>
          )}

          {!isLoading && bookings && bookings.length > 0 && (
            <ul className="reservation-list">
              {bookings.map((booking) => {
                const roomInfo = roomLookup?.get(booking.roomId)
                const checkIn = parseDateISO(booking.checkInDate)
                const checkOut = parseDateISO(booking.checkOutDate)
                const nights = checkIn && checkOut ? diffDays(checkOut, checkIn) : null
                const thumbnail = roomInfo?.room.images[0]

                return (
                  <li className="reservation-card" key={booking.reservationId}>
                    {/* 목록 클릭 시 이미 가진 데이터를 state로 함께 넘겨서, 상세 페이지가 다시 전체 목록을
                        불러오지 않고 바로 렌더링할 수 있게 한다 (새로고침 등으로 state가 없을 때만 재조회). */}
                    <Link
                      to={`/mypage/reservations/${booking.reservationId}`}
                      state={{ booking }}
                      className="reservation-card-link"
                    >
                      <div className="reservation-card-header">
                        <span className={`reservation-status reservation-status-${booking.status.toLowerCase()}`}>
                          {STATUS_LABEL[booking.status]}
                        </span>
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
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export default ReservationHistoryPage
