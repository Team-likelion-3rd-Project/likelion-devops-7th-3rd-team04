import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { fetchMyBookings, isUnauthorized, refreshAccessToken, type Booking } from '../api/gateway'
import type { Room } from '../api/hotels'
import type { Hotel } from '../data/hotels'
import { fetchMyPayments, type Payment } from '../api/payments'
import { CalendarIcon } from '../components/reservation/icons'
import { diffDays, formatDateWithWeekday, parseDateISO } from '../utils/date'
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_NOTICE,
  formatPaidAt,
  isManualPaymentStatus,
} from '../utils/payment'
import { fetchRoomLookup } from './reservationHistoryUtils'
import { currentLoginState } from '../utils/loginRedirect'
import './MyPage.css'
import './ReservationDetailPage.css'
import './PaymentDetailPage.css'

interface PaymentDetailLocationState {
  payment?: Payment
}

// 결제 내역 목록(PaymentsPage)에서 카드를 클릭하면 넘어오는 상세 페이지.
// 목록에서 state로 넘겨준 payment가 있으면 그대로 쓰고, 새로고침/직접 URL 접근 등으로
// state가 없을 때만 내 결제 목록을 다시 조회해 해당 paymentId를 찾는다.
function PaymentDetailPage() {
  const { paymentId } = useParams<{ paymentId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const statePayment = (location.state as PaymentDetailLocationState | null)?.payment

  const [payment, setPayment] = useState<Payment | null>(
    statePayment && String(statePayment.paymentId) === paymentId ? statePayment : null,
  )
  const [isLoading, setIsLoading] = useState(!payment)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [retryTick, setRetryTick] = useState(0)

  // 결제와 연결된 예약/객실 정보는 참고용이라, 조회에 실패해도 결제 상세 자체는 그대로 보여준다.
  const [booking, setBooking] = useState<Booking | null>(null)
  const [roomInfo, setRoomInfo] = useState<{ hotel: Hotel; room: Room } | null>(null)

  useEffect(() => {
    if (payment) return
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setNotFound(false)
      setLoadError('')
      const findMine = (payments: Payment[]) =>
        payments.find((p) => String(p.paymentId) === paymentId) ?? null

      try {
        const data = await fetchMyPayments()
        if (cancelled) return
        const found = findMine(data)
        if (found) setPayment(found)
        else setNotFound(true)
      } catch (err) {
        if (cancelled) return
        // fetchMyPayments()는 429 등을 이미 내부에서(요청 자체) 예산껏 재시도했다. 진짜 로그인이
        // 필요한 상태(401)가 아니면 재발급을 또 시도하지 않는다 — 안 그러면 이미 몰린 요청에
        // 부하만 배가된다.
        if (!isUnauthorized(err)) {
          setLoadError('일시적으로 결제 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다.
        try {
          await refreshAccessToken()
          const data = await fetchMyPayments()
          if (cancelled) return
          const found = findMine(data)
          if (found) setPayment(found)
          else setNotFound(true)
        } catch (err2) {
          if (cancelled) return
          if (isUnauthorized(err2)) {
            navigate('/login', { state: currentLoginState() })
          } else {
            setLoadError('일시적으로 결제 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
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
  }, [payment, paymentId, navigate, retryTick])

  useEffect(() => {
    if (!payment) return
    let cancelled = false

    const applyBookings = (bookings: Booking[], lookup: Awaited<ReturnType<typeof fetchRoomLookup>>) => {
      if (cancelled) return
      const found = bookings.find((b) => b.reservationId === payment.reservationId) ?? null
      setBooking(found)
      setRoomInfo(found ? (lookup.get(found.roomId) ?? null) : null)
    }

    const load = async () => {
      try {
        const [bookings, lookup] = await Promise.all([fetchMyBookings(), fetchRoomLookup()])
        applyBookings(bookings, lookup)
      } catch (err) {
        // fetchMyBookings()는 429 등을 이미 내부에서 예산껏 재시도했다. 진짜 401이 아니면 재발급을
        // 또 시도하지 않는다 — 이 정보(이용 기간/객실 썸네일)는 참고용이라 실패해도 조용히 비워둔다.
        if (!isUnauthorized(err)) {
          if (!cancelled) {
            setBooking(null)
            setRoomInfo(null)
          }
          return
        }
        // 새로고침 직후에는 액세스 토큰이 메모리에서 아직 복구되지 않았을 수 있으니
        // 리프레시 토큰(쿠키)으로 한 번 재발급을 시도한 뒤 다시 조회한다.
        try {
          await refreshAccessToken()
          const [bookings, lookup] = await Promise.all([fetchMyBookings(), fetchRoomLookup()])
          applyBookings(bookings, lookup)
        } catch {
          if (!cancelled) {
            setBooking(null)
            setRoomInfo(null)
          }
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [payment])

  const checkIn = booking ? parseDateISO(booking.checkInDate) : null
  const checkOut = booking ? parseDateISO(booking.checkOutDate) : null
  const nights = checkIn && checkOut ? diffDays(checkOut, checkIn) : null
  const thumbnail = roomInfo?.room.images[0]
  const statusKey = payment?.status.toLowerCase() ?? ''

  return (
    <section className="mypage-page">
      <div className="mypage-content">
        <div className="mypage-section">
          <div className="mypage-section-header">
            <h1 className="mypage-title">결제 상세 정보</h1>
          </div>

          <Link to="/mypage/payments" className="reservation-back-link">
            ← 결제 내역으로
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

          {!isLoading && notFound && <p className="mypage-status">결제 정보를 찾을 수 없습니다.</p>}

          {!isLoading && payment && (
            <div className="reservation-detail">
              {(thumbnail || roomInfo) && (
                <div className="reservation-detail-room">
                  {thumbnail ? (
                    <img className="reservation-detail-room-thumb" src={thumbnail.imageUrl} alt={roomInfo?.room.name} />
                  ) : (
                    <div className="reservation-detail-room-thumb is-placeholder" aria-hidden="true" />
                  )}
                  <div className="reservation-detail-room-info">
                    <h2>{roomInfo?.room.name ?? `객실 #${booking?.roomId}`}</h2>
                    {roomInfo && (
                      <p>
                        {roomInfo.hotel.name} · {roomInfo.hotel.location}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="reservation-detail-rows">
                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">결제 상태</span>
                  <span className={`payment-status payment-status-${statusKey}`}>
                    {PAYMENT_STATUS_LABEL[statusKey] ?? payment.status}
                  </span>
                </div>

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">결제 수단</span>
                  <span className="reservation-detail-value">
                    {PAYMENT_METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod}
                  </span>
                </div>

                {/* 간편결제(토스페이 등)는 카드 승인번호가 없어서 빈 값으로 온다 (#244) — 빈 줄은 보여주지 않는다 */}
                {payment.approvalNumber && (
                  <div className="reservation-detail-row">
                    <span className="reservation-detail-label">승인번호</span>
                    <span className="reservation-detail-value">{payment.approvalNumber}</span>
                  </div>
                )}

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">결제일시</span>
                  <span className="reservation-detail-value">{formatPaidAt(payment.paidAt)}</span>
                </div>

                {/* 환불이 끝난 결제만 (LDP-139) */}
                {payment.refundedAt && (
                  <div className="reservation-detail-row">
                    <span className="reservation-detail-label">환불일시</span>
                    <span className="reservation-detail-value">{formatPaidAt(payment.refundedAt)}</span>
                  </div>
                )}

                {checkIn && checkOut && (
                  <div className="reservation-detail-row">
                    <span className="reservation-detail-label">
                      <CalendarIcon /> 이용 기간
                    </span>
                    <span className="reservation-detail-value">
                      {formatDateWithWeekday(checkIn)} - {formatDateWithWeekday(checkOut)}
                      {nights != null && ` · ${nights}박`}
                    </span>
                  </div>
                )}

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">결제 금액</span>
                  <span className="reservation-detail-value reservation-detail-amount">
                    {payment.amount.toLocaleString()}원
                  </span>
                </div>

                <div className="reservation-detail-row">
                  <span className="reservation-detail-label">예약번호</span>
                  <span className="reservation-detail-value">#{payment.reservationId}</span>
                </div>
              </div>

              {/* 환불 진행 중·수동 확인 필요 등 상태별 안내 (LDP-139) */}
              {PAYMENT_STATUS_NOTICE[statusKey] && (
                <p className={isManualPaymentStatus(statusKey) ? 'mypage-warning' : 'mypage-hint'}>
                  {PAYMENT_STATUS_NOTICE[statusKey]}
                </p>
              )}

              <div className="mypage-actions">
                <Link
                  to={`/mypage/reservations/${payment.reservationId}`}
                  state={booking ? { booking } : undefined}
                  className="mypage-ghost-btn"
                >
                  예약 상세보기
                </Link>
                {/* 토스 영수증 (토스 결제만 주소가 있고 MOCK 결제는 빈 값, #244) — 토스 페이지라 새 창으로 연다 */}
                {payment.receiptUrl && (
                  <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer" className="mypage-ghost-btn">
                    영수증 보기
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default PaymentDetailPage
