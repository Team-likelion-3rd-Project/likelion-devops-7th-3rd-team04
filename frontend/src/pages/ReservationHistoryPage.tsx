import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchMyBookingsPage, type Booking } from '../api/gateway'
import { diffDays, parseDateISO } from '../utils/date'
import { STATUS_LABEL, formatDate, fetchRoomLookup, type RoomWithHotel } from './reservationHistoryUtils'
import { useMyPagedList } from '../utils/useMyPagedList'
import './MyPage.css'
import './ReservationHistoryPage.css'

const LOAD_ERROR = '일시적으로 예약 내역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'
const bookingKey = (booking: Booking) => booking.reservationId

// "예약하기"(ReservationPage, /reservation)와는 다른 페이지: 로그인한 사용자 본인의 지난 예약 목록을 보여준다.
// 목록에는 요약 정보만 보여주고, 상세 정보는 클릭 시 이동하는 ReservationDetailPage(/mypage/reservations/:reservationId)에서 보여준다.
function ReservationHistoryPage() {
  // 한 페이지(20건)씩 불러오고 "더 보기"로 이어 붙인다 (부하 테스트 11-06 — 전체를 한 번에 받지 않는다)
  const {
    items: bookings,
    hasMore,
    isLoading,
    loadError,
    retry,
    loadMore,
    isLoadingMore,
    loadMoreError,
  } = useMyPagedList(fetchMyBookingsPage, bookingKey, LOAD_ERROR)
  const [retryTick, setRetryTick] = useState(0)

  // roomId -> {hotel, room} 맵. 어느 호텔/객실인지 예약 데이터만으로는 알 수 없어 목록 진입 시
  // 한 번에 조회해두고, 카드마다 booking.roomId로 찾아 쓴다.
  const [roomLookup, setRoomLookup] = useState<Map<number, RoomWithHotel> | null>(null)

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
  }, [retryTick])

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
              <button
                type="button"
                className="mypage-ghost-btn"
                onClick={() => {
                  retry()
                  setRetryTick((t) => t + 1)
                }}
              >
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
                            src={thumbnail.imageUrl}
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

          {!isLoading && hasMore && (
            <div className="mypage-status">
              {loadMoreError && <p className="mypage-error">{loadMoreError}</p>}
              <button type="button" className="mypage-ghost-btn" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? '불러오는 중...' : '더 보기'}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default ReservationHistoryPage
