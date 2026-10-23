import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  cancelBooking,
  fetchMyBookings,
  isUnauthorized,
  refreshAccessToken,
  type Booking,
  type ChatAction,
} from '../../api/gateway'
import { fetchRooms } from '../../api/hotels'
import { PAYMENT_BLOCK_MESSAGE, formatPaymentDue, paymentBlockReason } from '../../api/payments'
import { getHotels } from '../../data/hotelStore'
import { fetchRoomLookup, formatDate, type RoomWithHotel } from '../../pages/reservationHistoryUtils'
import { diffDays, formatDateWithWeekday, parseDateISO } from '../../utils/date'
import { currentLoginState } from '../../utils/loginRedirect'
import { toReservationSearchParams } from '../../utils/reservationQuery'
import PaymentModal from '../reservation/PaymentModal'
import './ChatActionCard.css'

// 챗봇 답변 아래에 붙는 액션 카드.
// 보안상 원칙: 카드의 데이터(예약 대상·금액·링크)는 LLM 출력이 아니라 프론트가 직접 만든다.
// - BOOK: 서버가 검증한 슬롯으로 기존 예약 화면 딥링크를 만들 뿐, 예약은 그 화면에서 사용자가 한다.
// - PAY/CANCEL: 본인 예약을 사용자 JWT로 직접 조회해 보여주고, 실행은 기존 API(PaymentModal/cancelBooking)로 한다.
// 정정 전의 낡은 값으로 진행하지 않도록, 가장 최근 봇 메시지의 카드만 누를 수 있다(active).

interface ChatActionCardProps {
  action: ChatAction
  active: boolean
}

function ChatActionCard({ action, active }: ChatActionCardProps) {
  if (!active) {
    return <div className="chat-action-card is-inactive">이전 안내예요. 가장 최근 안내를 이용해주세요.</div>
  }
  switch (action.type) {
    case 'LOGIN_REQUIRED':
      return <LoginRequiredCard />
    case 'BOOK':
      return <BookCard action={action} />
    case 'PAY':
      return <PayCard />
    case 'CANCEL':
      return <CancelCard />
    default:
      return null
  }
}

function LoginRequiredCard() {
  const navigate = useNavigate()
  return (
    <div className="chat-action-card">
      <p className="chat-action-title">로그인이 필요해요</p>
      <p className="chat-action-meta">예약·결제·취소는 로그인 후 이용할 수 있어요.</p>
      <button
        type="button"
        className="chat-action-primary"
        onClick={() => navigate('/login', { state: currentLoginState() })}
      >
        로그인
      </button>
    </div>
  )
}

function formatPeriod(checkInDate: string, checkOutDate: string): string | undefined {
  const checkIn = parseDateISO(checkInDate)
  const checkOut = parseDateISO(checkOutDate)
  if (!checkIn || !checkOut) return undefined
  return `${formatDateWithWeekday(checkIn)} - ${formatDateWithWeekday(checkOut)} · ${diffDays(checkOut, checkIn)}박`
}

function BookCard({ action }: { action: ChatAction }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  const hotel = getHotels().find((h) => h.id === action.hotel) ?? null
  const checkIn = action.checkIn ? parseDateISO(action.checkIn) : null
  const checkOut = action.checkOut ? parseDateISO(action.checkOut) : null
  if (!hotel || !checkIn || !checkOut) return null

  const adults = action.adults ?? 2
  const children = action.children ?? 0

  // 객실명이 그 지점의 실제 객실과 일치하면 옵션 단계로, 아니면 객실 선택 단계로 보낸다.
  const handleOpen = async () => {
    const params = toReservationSearchParams({
      hotelSlug: hotel.id,
      checkIn,
      checkOut,
      rooms: [{ adults, children, infants: 0 }],
    })
    if (!action.roomName) {
      navigate(`/reservation/rooms?${params.toString()}`)
      return
    }
    setStatus('loading')
    try {
      const rooms = await fetchRooms(hotel.hotelId)
      const room = rooms.find((r) => r.name === action.roomName)
      if (room) {
        params.set('room', String(room.roomId))
        navigate(`/reservation/options?${params.toString()}`)
      } else {
        navigate(`/reservation/rooms?${params.toString()}`)
      }
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="chat-action-card">
      <p className="chat-action-title">예약 정보 확인</p>
      <dl className="chat-action-details">
        <dt>지점</dt>
        <dd>{hotel.name}</dd>
        {action.roomName && (
          <>
            <dt>객실</dt>
            <dd>{action.roomName}</dd>
          </>
        )}
        <dt>일정</dt>
        <dd>{formatPeriod(action.checkIn!, action.checkOut!)}</dd>
        <dt>인원</dt>
        <dd>
          성인 {adults}명{children > 0 && `, 아동 ${children}명`}
        </dd>
      </dl>
      <p className="chat-action-meta">예약 화면에서 내용과 금액을 확인한 뒤 예약을 완료해주세요.</p>
      {status === 'error' && <p className="chat-action-error">객실 정보를 불러오지 못했어요. 다시 시도해주세요.</p>}
      <button type="button" className="chat-action-primary" onClick={handleOpen} disabled={status === 'loading'}>
        {status === 'loading' ? '여는 중...' : '예약 화면에서 확인'}
      </button>
    </div>
  )
}

type LoadState = 'loading' | 'ready' | 'error' | 'unauthorized'

// 본인 예약 + roomId -> {호텔, 객실} 맵을 불러온다. 새로고침 직후엔 액세스 토큰이 메모리에 없을 수 있어
// 401이면 리프레시 토큰으로 한 번 재발급한 뒤 다시 조회한다(PaymentsPendingPage와 같은 방식).
function useMyBookings() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [roomLookup, setRoomLookup] = useState<Map<number, RoomWithHotel>>(new Map())
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false

    const loadBookings = async () => {
      try {
        return await fetchMyBookings()
      } catch (err) {
        if (!isUnauthorized(err)) throw err
        await refreshAccessToken()
        return fetchMyBookings()
      }
    }

    Promise.all([loadBookings(), fetchRoomLookup().catch(() => new Map<number, RoomWithHotel>())])
      .then(([data, lookup]) => {
        if (cancelled) return
        setBookings(data)
        setRoomLookup(lookup)
        setState('ready')
      })
      .catch((err) => {
        if (!cancelled) setState(isUnauthorized(err) ? 'unauthorized' : 'error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { bookings, setBookings, roomLookup, state }
}

function BookingSummary({ booking, roomInfo }: { booking: Booking; roomInfo?: RoomWithHotel }) {
  return (
    <>
      <p className="chat-action-item-title">
        {roomInfo ? `${roomInfo.hotel.name} · ${roomInfo.room.name}` : `객실 #${booking.roomId}`}
      </p>
      <p className="chat-action-meta">
        {formatDate(booking.checkInDate)} ~ {formatDate(booking.checkOutDate)} · {booking.guestCount}명 ·{' '}
        {booking.totalAmount.toLocaleString()}원
      </p>
    </>
  )
}

function LoadStatus({ state }: { state: LoadState }) {
  const navigate = useNavigate()
  if (state === 'loading') return <p className="chat-action-meta">예약 내역을 불러오는 중...</p>
  if (state === 'unauthorized') {
    return (
      <>
        <p className="chat-action-meta">로그인이 만료되었어요.</p>
        <button
          type="button"
          className="chat-action-primary"
          onClick={() => navigate('/login', { state: currentLoginState() })}
        >
          로그인
        </button>
      </>
    )
  }
  return <p className="chat-action-error">예약 내역을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>
}

function PayCard() {
  const navigate = useNavigate()
  const { bookings, setBookings, roomLookup, state } = useMyBookings()
  const [paying, setPaying] = useState<Booking | null>(null)

  const pending = bookings.filter((b) => b.status === 'PENDING_PAYMENT')

  return (
    <div className="chat-action-card">
      <p className="chat-action-title">결제 대기 중인 예약</p>
      {state !== 'ready' ? (
        <LoadStatus state={state} />
      ) : pending.length === 0 ? (
        <>
          <p className="chat-action-meta">결제 대기 중인 예약이 없어요.</p>
          <button type="button" className="chat-action-secondary" onClick={() => navigate('/mypage/payments')}>
            결제 내역 보기
          </button>
        </>
      ) : (
        <ul className="chat-action-list">
          {pending.map((booking) => {
            const block = paymentBlockReason(booking)
            const due = formatPaymentDue(booking.paymentDueAt)
            return (
              <li key={booking.reservationId} className="chat-action-item">
                <BookingSummary booking={booking} roomInfo={roomLookup.get(booking.roomId)} />
                {due && <p className="chat-action-meta">결제 기한 {due}</p>}
                {block && <p className="chat-action-error">{PAYMENT_BLOCK_MESSAGE[block]}</p>}
                <button
                  type="button"
                  className="chat-action-primary"
                  onClick={() => setPaying(booking)}
                  disabled={block !== null}
                >
                  {block === 'CONFIRMING' ? '결제 확인 중' : '결제하기'}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* 채팅 패널은 애니메이션(transform) 때문에 position:fixed 기준이 바뀔 수 있어 모달은 body로 띄운다 */}
      {paying &&
        createPortal(
          <PaymentModal
            reservationId={paying.reservationId}
            summary={{
              roomName: roomLookup.get(paying.roomId)?.room.name ?? `객실 #${paying.roomId}`,
              hotelName: roomLookup.get(paying.roomId)?.hotel.name,
              period: formatPeriod(paying.checkInDate, paying.checkOutDate),
              amount: paying.totalAmount,
            }}
            onClose={() => setPaying(null)}
            onBookingChange={(latest) =>
              setBookings((prev) => prev.map((b) => (b.reservationId === latest.reservationId ? latest : b)))
            }
          />,
          document.body,
        )}
    </div>
  )
}

function CancelCard() {
  const navigate = useNavigate()
  const { bookings, setBookings, roomLookup, state } = useMyBookings()
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [cancelledIds, setCancelledIds] = useState<number[]>([])
  // 취소 전에 결제 완료였던 예약 — 취소 뒤에는 상태가 CANCELLED라 환불 안내를 고르려고 따로 기억한다
  const [refundIds, setRefundIds] = useState<number[]>([])
  const [error, setError] = useState('')

  const cancellable = bookings.filter(
    (b) => b.status === 'PENDING_PAYMENT' || b.status === 'RESERVED' || cancelledIds.includes(b.reservationId),
  )

  const handleCancel = async (booking: Booking) => {
    setSubmittingId(booking.reservationId)
    setError('')
    try {
      const updated = await cancelBooking(booking.reservationId)
      setBookings((prev) => prev.map((b) => (b.reservationId === updated.reservationId ? updated : b)))
      setCancelledIds((prev) => [...prev, booking.reservationId])
      if (booking.status === 'RESERVED') setRefundIds((prev) => [...prev, booking.reservationId])
      setConfirmingId(null)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '예약을 취소하지 못했어요. 잠시 후 다시 시도해주세요.')
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <div className="chat-action-card">
      <p className="chat-action-title">취소할 수 있는 예약</p>
      {state !== 'ready' ? (
        <LoadStatus state={state} />
      ) : cancellable.length === 0 ? (
        <p className="chat-action-meta">취소할 수 있는 예약이 없어요.</p>
      ) : (
        <ul className="chat-action-list">
          {cancellable.map((booking) => {
            const isCancelled = cancelledIds.includes(booking.reservationId)
            const isPaid = booking.status === 'RESERVED'
            const isConfirming = confirmingId === booking.reservationId
            const isSubmitting = submittingId === booking.reservationId
            return (
              <li key={booking.reservationId} className="chat-action-item">
                <BookingSummary booking={booking} roomInfo={roomLookup.get(booking.roomId)} />
                {isCancelled ? (
                  <div className="chat-action-confirm">
                    <p className="chat-action-done">
                      {refundIds.includes(booking.reservationId)
                        ? '취소되었어요. 결제 금액은 전액 환불을 진행하고 있어요.'
                        : '취소되었어요. 결제 전 예약이라 바로 해제됐어요.'}
                    </p>
                    {/* 예약 상세에 환불 진행 상황(환불 처리중·환불됨·확인 필요)이 보인다 (#280) */}
                    <button
                      type="button"
                      className="chat-action-secondary"
                      onClick={() =>
                        navigate(`/mypage/reservations/${booking.reservationId}`, {
                          state: { booking: bookings.find((b) => b.reservationId === booking.reservationId) },
                        })
                      }
                    >
                      {refundIds.includes(booking.reservationId) ? '환불 진행 상황 보기' : '예약 상세 보기'}
                    </button>
                  </div>
                ) : isConfirming ? (
                  <div className="chat-action-confirm">
                    <p className="chat-action-meta">
                      {isPaid
                        ? `정말 취소할까요? 결제 금액 ${booking.totalAmount.toLocaleString()}원이 전액 환불돼요.`
                        : '정말 취소할까요? 결제 전 예약이라 바로 해제돼요.'}
                    </p>
                    <div className="chat-action-buttons">
                      <button
                        type="button"
                        className="chat-action-secondary"
                        onClick={() => setConfirmingId(null)}
                        disabled={isSubmitting}
                      >
                        돌아가기
                      </button>
                      <button
                        type="button"
                        className="chat-action-danger"
                        onClick={() => handleCancel(booking)}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? '취소 중...' : '취소 확정'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="chat-action-meta">{isPaid ? '결제 완료 · 취소 시 전액 환불' : '결제 대기'}</p>
                    <button
                      type="button"
                      className="chat-action-secondary"
                      onClick={() => setConfirmingId(booking.reservationId)}
                      disabled={submittingId !== null}
                    >
                      취소하기
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="chat-action-error">{error}</p>}
    </div>
  )
}

export default ChatActionCard
