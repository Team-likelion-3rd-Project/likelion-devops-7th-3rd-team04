import { Fragment, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  cancelBooking,
  fetchMyBookings,
  fetchReservationFacilities,
  isUnauthorized,
  refreshAccessToken,
  type Booking,
  type ReservationFacility,
} from '../api/gateway'
import { toImageDataUrl, type Room } from '../api/hotels'
import type { Hotel } from '../data/hotels'
import { CalendarIcon, PersonIcon, PinIcon } from '../components/reservation/icons'
import PaymentModal from '../components/reservation/PaymentModal'
import { diffDays, formatDateWithWeekday, parseDateISO } from '../utils/date'
import { STATUS_LABEL, fetchRoomLookup } from './reservationHistoryUtils'
import { currentLoginState } from '../utils/loginRedirect'
import './MyPage.css'
import './ReservationDetailPage.css'

interface ReservationDetailLocationState {
  booking?: Booking
}

// 예약 목록(ReservationHistoryPage)에서 카드를 클릭하면 넘어오는 상세 페이지.
// 목록에서 state로 넘겨준 booking이 있으면 그대로 쓰고, 새로고침/직접 URL 접근 등으로
// state가 없을 때만 내 예약 목록을 다시 조회해 해당 reservationId를 찾는다.
function ReservationDetailPage() {
  const { reservationId } = useParams<{ reservationId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const stateBooking = (location.state as ReservationDetailLocationState | null)?.booking

  const [booking, setBooking] = useState<Booking | null>(
    stateBooking && String(stateBooking.reservationId) === reservationId ? stateBooking : null,
  )
  const [isLoading, setIsLoading] = useState(!booking)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [retryTick, setRetryTick] = useState(0)

  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)

  const [roomInfo, setRoomInfo] = useState<{ hotel: Hotel; room: Room } | null>(null)
  const [isRoomLoading, setIsRoomLoading] = useState(false)

  const [facilities, setFacilities] = useState<ReservationFacility[]>([])

  useEffect(() => {
    if (booking) return
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setNotFound(false)
      setLoadError('')
      const findMine = (bookings: Booking[]) =>
        bookings.find((b) => String(b.reservationId) === reservationId) ?? null

      try {
        const data = await fetchMyBookings()
        if (cancelled) return
        const found = findMine(data)
        if (found) setBooking(found)
        else setNotFound(true)
      } catch (err) {
        if (cancelled) return
        // fetchMyBookings()는 429 등을 이미 내부에서(요청 자체) 예산껏 재시도했다. 진짜 로그인이
        // 필요한 상태(401)가 아니면 재발급을 또 시도하지 않는다 — 안 그러면 이미 몰린 요청에
        // 부하만 배가된다.
        if (!isUnauthorized(err)) {
          setLoadError('일시적으로 예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다.
        try {
          await refreshAccessToken()
          const data = await fetchMyBookings()
          if (cancelled) return
          const found = findMine(data)
          if (found) setBooking(found)
          else setNotFound(true)
        } catch (err2) {
          if (cancelled) return
          if (isUnauthorized(err2)) {
            navigate('/login', { state: currentLoginState() })
          } else {
            setLoadError('일시적으로 예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
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
  }, [booking, reservationId, navigate, retryTick])

  // 예약이 확정되면 그제서야 어느 호텔/객실인지 조회한다 (booking.roomId만으로는 hotelId를 알 수 없어서
  // fetchRoomLookup이 등록된 호텔들의 객실을 전부 불러와 roomId로 찾는다. 자세한 내용은 해당 함수 주석 참고).
  useEffect(() => {
    if (!booking) return
    let cancelled = false

    const load = async () => {
      setIsRoomLoading(true)
      try {
        const lookup = await fetchRoomLookup()
        if (!cancelled) setRoomInfo(lookup.get(booking.roomId) ?? null)
      } catch {
        if (!cancelled) setRoomInfo(null)
      } finally {
        if (!cancelled) setIsRoomLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [booking])

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

  const handleCancel = async () => {
    if (!booking) return
    setCancelError('')
    setIsCancelling(true)
    try {
      const updated = await cancelBooking(booking.reservationId)
      setBooking(updated)
      setIsCancelModalOpen(false)
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : '예약 취소에 실패했습니다.')
    } finally {
      setIsCancelling(false)
    }
  }

  const checkIn = booking ? parseDateISO(booking.checkInDate) : null
  const checkOut = booking ? parseDateISO(booking.checkOutDate) : null
  const nights = checkIn && checkOut ? diffDays(checkOut, checkIn) : null

  const selectedOptionLabels = facilities.map((f) => `${f.facilityName} ${f.guestCount}인`)
  const hasPoolFacility = facilities.some((f) => f.facilityName === '수영장')
  const hasLoungeFacility = facilities.some((f) => f.facilityName === '라운지')

  const thumbnail = roomInfo?.room.images[0]

  return (
    <section className="mypage-page">
      <div className="mypage-content">
        <div className="mypage-section">
          <div className="mypage-section-header">
            <h1 className="mypage-title">예약 상세 정보</h1>
          </div>

          <Link to="/mypage/reservations" className="reservation-back-link">
            ← 예약 목록으로
          </Link>

          {isLoading && <p className="mypage-status">불러오는 중...</p>}

          {!isLoading && loadError && (
            <div className="mypage-status">
              <p className="mypage-error">{loadError}</p>
              <button type="button" className="mypage-ghost-btn" onClick={() => setRetryTick((t) => t + 1)}>
                다시 시도
              </button>
            </div>
          )}

          {!isLoading && notFound && <p className="mypage-status">예약 정보를 찾을 수 없습니다.</p>}

          {!isLoading && booking && (
            <div className="reservation-detail">
              <div className="reservation-detail-room">
                {thumbnail ? (
                  <img
                    className="reservation-detail-room-thumb"
                    src={toImageDataUrl(thumbnail)}
                    alt={roomInfo?.room.name}
                  />
                ) : (
                  <div className="reservation-detail-room-thumb is-placeholder" aria-hidden="true" />
                )}
                <div className="reservation-detail-room-info">
                  <h2>{isRoomLoading ? '객실 정보를 불러오는 중...' : (roomInfo?.room.name ?? `객실 #${booking.roomId}`)}</h2>
                  {roomInfo && <p>기준 인원 {roomInfo.room.capacity}명</p>}
                </div>
              </div>

              <div className="reservation-detail-rows">
                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">
                    <PinIcon /> 호텔/지역
                  </span>
                  <span className="reservation-detail-value">
                    {roomInfo ? `${roomInfo.hotel.name} · ${roomInfo.hotel.location}` : '정보를 찾을 수 없습니다'}
                  </span>
                </div>

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">
                    <CalendarIcon /> 체크인/체크아웃
                  </span>
                  <span className="reservation-detail-value">
                    {checkIn && checkOut
                      ? `${formatDateWithWeekday(checkIn)} - ${formatDateWithWeekday(checkOut)}${
                          nights != null ? ` · ${nights}박` : ''
                        }`
                      : '정보를 찾을 수 없습니다'}
                  </span>
                </div>

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">
                    <PersonIcon /> 투숙인원
                  </span>
                  <span className="reservation-detail-value">총 {booking.guestCount}명</span>
                </div>

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">선택한 옵션</span>
                  <span className="reservation-detail-value">
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

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">결제 금액</span>
                  <span className="reservation-detail-value reservation-detail-amount">
                    {booking.totalAmount.toLocaleString()}원
                  </span>
                </div>

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">예약 상태</span>
                  <span className={`reservation-status reservation-status-${booking.status.toLowerCase()}`}>
                    {STATUS_LABEL[booking.status]}
                  </span>
                </div>
              </div>

              <div className="reservation-detail-notice">
                <p className="reservation-detail-notice-title">이용 안내</p>
                <ul>
                  <li>예약 확인 및 취소는 마이페이지의 예약 내역에서 하실 수 있습니다.</li>
                  {selectedOptionLabels.length > 0 && (
                    <li>선택하신 옵션은 체크인 시 프런트에서 이용권으로 교환해 드립니다.</li>
                  )}
                  {hasPoolFacility && (
                    <li>수영장 이용 시 수영모 착용은 필수이며, 만 12세 이하 어린이는 보호자 동반 하에 이용 가능합니다.</li>
                  )}
                  {hasLoungeFacility && <li>라운지 내 취식은 지정된 좌석에서만 가능하며, 외부 음식 반입은 제한됩니다.</li>}
                  <li>기타 문의사항은 프런트 데스크(02-0000-0000)로 연락해 주세요.</li>
                </ul>
              </div>

              {(booking.status === 'PENDING_PAYMENT' || booking.status === 'RESERVED') && (
                <div className="mypage-actions">
                  {booking.status === 'PENDING_PAYMENT' && (
                    <button type="button" className="mypage-submit" onClick={() => setShowPaymentModal(true)}>
                      결제하기
                    </button>
                  )}
                  <button type="button" className="mypage-ghost-btn" onClick={() => setIsCancelModalOpen(true)}>
                    예약 취소
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isCancelModalOpen && booking && (
        <div className="mypage-modal-overlay" onClick={() => setIsCancelModalOpen(false)}>
          <div
            className="mypage-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="cancel-modal-title">예약을 취소하시겠어요?</h2>
            <p className="mypage-warning">
              {checkIn && checkOut ? `${formatDateWithWeekday(checkIn)} - ${formatDateWithWeekday(checkOut)}` : ''}{' '}
              예약이 취소되며, 되돌릴 수 없습니다.
            </p>

            {cancelError && <p className="mypage-error">{cancelError}</p>}

            <div className="mypage-actions">
              <button
                type="button"
                className="mypage-ghost-btn"
                onClick={() => setIsCancelModalOpen(false)}
                disabled={isCancelling}
              >
                닫기
              </button>
              <button type="button" className="mypage-danger-btn" onClick={handleCancel} disabled={isCancelling}>
                {isCancelling ? '취소 처리 중...' : '예약 취소'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && booking && (
        <PaymentModal
          reservationId={booking.reservationId}
          summary={{
            roomName: roomInfo ? roomInfo.room.name : `객실 #${booking.roomId}`,
            hotelName: roomInfo?.hotel.name,
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
    </section>
  )
}

export default ReservationDetailPage
