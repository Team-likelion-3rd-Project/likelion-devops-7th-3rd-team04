import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useHotels } from '../data/hotelStore'
import { fetchRoom, fetchRoomAvailability } from '../api/hotels'
import type { Room, RoomAvailabilityDay } from '../api/hotels'
import { createBooking } from '../api/bookings'
import { refreshAccessToken } from '../api/gateway'
import { customerAuth } from '../api/tokenStore'
import ReservationSteps from '../components/reservation/ReservationSteps'
import { sumGuests } from '../components/reservation/guestTypes'
import { CalendarIcon, PersonIcon, PinIcon, RefreshIcon } from '../components/reservation/icons'
import { addDays, diffDays, formatDate, formatDateISO, formatDateWithWeekday, parseDateISO } from '../utils/date'
import { parseReservationSearchParams, toReservationSearchParams } from '../utils/reservationQuery'
import { currentLoginState } from '../utils/loginRedirect'
import './ReservationOptionsPage.css'

type LoadStatus = 'loading' | 'success' | 'error'

interface OptionItem {
  key: string
  label: string
  /** 사이드바 요금 내역에서 "{shortName} {n}인 이용" 형태로 쓰는 축약 이름 */
  shortName: string
  /** 1인 1회 기준, 부가가치세 포함 금액 */
  price: number
}

// 백엔드에 옵션 상품 API가 아직 없어, 요구사항대로 수영장/라운지 이용 두 가지만 프론트에서 고정값으로 둔다.
const OPTIONS: OptionItem[] = [
  { key: 'pool', label: '수영장 이용', shortName: '수영장', price: 30000 },
  { key: 'lounge', label: '라운지 이용', shortName: '라운지', price: 50000 },
]

function ReservationOptionsPage() {
  // 호텔 이름·소개는 API(GET /api/hotels) 응답으로 갱신된다 (data/hotelStore.ts)
  const hotels = useHotels()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // 1단계 검색 조건 + 2단계(객실 선택)에서 실어 보낸 room 쿼리스트링을 함께 읽는다.
  const search = useMemo(() => parseReservationSearchParams(searchParams), [searchParams])
  const hotel = search ? hotels.find((h) => h.id === search.hotelSlug) ?? null : null
  const roomIdRaw = searchParams.get('room')
  const roomId = roomIdRaw ? Number(roomIdRaw) : null

  const [room, setRoom] = useState<Room | null>(null)
  const [roomStatus, setRoomStatus] = useState<LoadStatus>('loading')
  const [nightlyPrices, setNightlyPrices] = useState<RoomAvailabilityDay[]>([])
  const [priceStatus, setPriceStatus] = useState<LoadStatus>('loading')
  const [optionCounts, setOptionCounts] = useState<Record<string, number>>({})
  const [bookingStatus, setBookingStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [bookingError, setBookingError] = useState('')

  // 검색 조건/호텔/선택한 객실 중 하나라도 없으면 (예: 페이지 직접 접근) 이전 단계로 돌려보낸다.
  useEffect(() => {
    if (search && hotel && roomId) return
    navigate(search ? `/reservation/rooms?${toReservationSearchParams(search).toString()}` : '/reservation', {
      replace: true,
    })
  }, [search, hotel, roomId, navigate])

  useEffect(() => {
    if (!hotel || !roomId) return
    let cancelled = false

    fetchRoom(hotel.hotelId, roomId)
      .then((data) => {
        if (cancelled) return
        setRoom(data)
        setRoomStatus('success')
      })
      .catch(() => {
        if (cancelled) return
        setRoomStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [hotel, roomId])

  useEffect(() => {
    if (!search || !hotel || !roomId) return
    let cancelled = false

    // 예약 가능 여부/가격 조회는 "묵는 마지막 날 밤"까지만 포함한다 — 체크아웃 당일은 밤을 보내지 않는다.
    const startDate = formatDateISO(search.checkIn)
    const endDate = formatDateISO(addDays(search.checkOut, -1))

    fetchRoomAvailability(hotel.hotelId, roomId, startDate, endDate)
      .then((data) => {
        if (cancelled) return
        setNightlyPrices(data.availabilities)
        setPriceStatus('success')
      })
      .catch(() => {
        if (cancelled) return
        setPriceStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [search, hotel, roomId])

  if (!search || !hotel || !roomId) {
    // useEffect가 이전 단계로 돌려보내는 동안 잠깐 보여줄 빈 화면
    return null
  }

  const nights = diffDays(search.checkOut, search.checkIn)
  const guests = sumGuests(search.rooms)
  const totalGuests = guests.adults + guests.children + guests.infants
  const backToRoomsUrl = `/reservation/rooms?${toReservationSearchParams(search).toString()}`
  const backToSearchUrl = `/reservation?${toReservationSearchParams(search).toString()}`

  const roomTotal = nightlyPrices.reduce((sum, day) => sum + day.price, 0)
  const optionsTotal = OPTIONS.reduce((sum, opt) => sum + opt.price * (optionCounts[opt.key] ?? 0), 0)
  const grandTotal = roomTotal + optionsTotal

  // 옵션은 인원수를 넘겨 선택할 이유가 없으므로, 총 투숙인원을 상한으로 둔다.
  const updateOptionCount = (key: string, value: number) => {
    setOptionCounts((prev) => ({ ...prev, [key]: Math.min(totalGuests, Math.max(0, value)) }))
  }

  // 예약 - 결제 프로세스 변경: 이 페이지는 결제 없이 예약만 먼저 생성한다(booking-service
  // POST /api/bookings). 서버가 예약을 PENDING_PAYMENT 상태로 만들며, 실제 결제(POST /api/payments)는
  // 이어지는 예약완료 페이지(ReservationCompletePage)나 내 예약 내역 상세 페이지에서 별도로 진행한다.
  // 옵션(수영장/라운지) 이용 인원수를 그대로 실어 보낸다 — 서버가 hotel-service의 facilities 테이블에서
  // 실제 단가를 조회해 인원수만큼 곱해 요금에 반영한다(hasIndoorPool/hasLounge boolean 방식은 폐지됨).
  const handleReserve = async () => {
    if (!customerAuth.getAccessToken()) {
      // 새로고침 직후에는 액세스 토큰이 아직 복구되지 않았을 수 있으니 쿠키로 한 번 복구해 본다.
      // 그래도 안 되면 로그인 화면으로 보내고, 로그인 후 지금 고른 조건(쿼리 포함) 그대로 이 화면으로 돌아온다.
      try {
        await refreshAccessToken()
      } catch {
        navigate('/login', { state: currentLoginState('예약하려면 로그인이 필요합니다.') })
        return
      }
    }

    setBookingStatus('submitting')
    setBookingError('')
    try {
      const booking = await createBooking({
        roomId,
        hotelId: hotel.hotelId,
        checkInDate: formatDateISO(search.checkIn),
        checkOutDate: formatDateISO(search.checkOut),
        guestCount: totalGuests,
        poolGuestCount: optionCounts.pool ?? 0,
        loungeGuestCount: optionCounts.lounge ?? 0,
      })
      // 예약 완료 페이지로 이동하면서, 이미 가진 정보(호텔/객실/투숙인원)를 함께 실어 보내
      // 완료 페이지가 다시 조회하지 않고도 바로 렌더링할 수 있게 한다.
      navigate(`/reservation/complete/${booking.reservationId}`, {
        state: { booking, hotel, room, guestRooms: search.rooms },
      })
    } catch (err) {
      setBookingStatus('error')
      setBookingError(err instanceof Error ? err.message : '예약 생성에 실패했습니다.')
    }
  }

  return (
    <section className="reservation-options-page">
      <div className="reservation-page-header">
        <h1>객실예약</h1>
        <ReservationSteps activeStep={2} />
      </div>

      <div className="reservation-options-body">
        <div className="reservation-options-main">
          <div className="reservation-options-room-header">
            <h2>
              {roomStatus === 'loading' && '불러오는 중…'}
              {roomStatus === 'error' && '객실 정보를 불러오지 못했습니다'}
              {roomStatus === 'success' && room?.name}{' '}
              <span className="reservation-options-room-guests">
                성인 {guests.adults}, 어린이 {guests.children}, 유아 {guests.infants}
              </span>
            </h2>
          </div>

          <div className="reservation-options-section">
            <h3>옵션 사항</h3>

            <ul className="reservation-option-list">
              {OPTIONS.map((opt) => {
                const count = optionCounts[opt.key] ?? 0
                return (
                  <li className="reservation-option-row" key={opt.key}>
                    <span className="reservation-option-name">{opt.label}</span>
                    <span className="reservation-option-price">{opt.price.toLocaleString()}원</span>
                    <div className="reservation-option-stepper">
                      <button
                        type="button"
                        onClick={() => updateOptionCount(opt.key, count - 1)}
                        disabled={count <= 0}
                        aria-label={`${opt.label} 감소`}
                      >
                        −
                      </button>
                      <span className="reservation-option-stepper-value">{count}</span>
                      <button
                        type="button"
                        onClick={() => updateOptionCount(opt.key, count + 1)}
                        disabled={count >= totalGuests}
                        aria-label={`${opt.label} 증가`}
                      >
                        +
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="reservation-options-notice">
              <p className="reservation-options-notice-group-title">공통 안내</p>
              <ul className="reservation-options-note">
                <li>모든 옵션 요금은 부가가치세 10%가 포함된 금액입니다.</li>
                <li>옵션 요금은 1인 1회 기준이며, 투숙 인원 수에 맞춰 선택해주시기 바랍니다.</li>
                <li>선택하신 옵션은 체크인 시 프런트에서 이용권으로 교환해 드립니다.</li>
              </ul>

              <p className="reservation-options-notice-group-title">수영장 이용 시 유의사항</p>
              <ul className="reservation-options-note">
                <li>이용 가능 시간은 06:00 ~ 22:00이며, 시설 점검 등의 사유로 사전 공지 없이 변경될 수 있습니다.</li>
                <li>수영모 착용은 필수이며, 미착용 시 이용이 제한될 수 있습니다.</li>
                <li>만 12세 이하 어린이는 보호자 동반 하에만 이용 가능합니다.</li>
                <li>우천 또는 기상 악화 시 야외 시설 이용이 제한될 수 있습니다.</li>
              </ul>

              <p className="reservation-options-notice-group-title">라운지 이용 시 유의사항</p>
              <ul className="reservation-options-note">
                <li>이용 가능 시간은 07:00 ~ 21:00이며, 시간대별로 제공되는 식음료 구성이 달라질 수 있습니다.</li>
                <li>라운지 내 취식은 지정된 좌석에서만 가능하며, 외부 음식 반입은 제한됩니다.</li>
                <li>편안한 이용을 위해 반바지·슬리퍼 등 캐주얼 복장은 삼가주시기 바랍니다.</li>
                <li>혼잡한 시간대에는 좌석 대기가 발생할 수 있습니다.</li>
              </ul>
            </div>
          </div>

          <div className="reservation-options-actions">
            <Link className="reservation-options-back" to={backToRoomsUrl}>
              이전
            </Link>
          </div>
        </div>

        <aside className="reservation-options-summary">
          <div className="reservation-options-summary-header">
            <Link className="reservation-options-refresh" to={backToSearchUrl}>
              <RefreshIcon /> 재검색
            </Link>
          </div>

          <div className="reservation-options-summary-info">
            <div className="reservation-options-summary-row">
              <span className="reservation-options-summary-label">
                <PinIcon /> 호텔/지역
              </span>
              <span className="reservation-options-summary-value">{hotel.name}</span>
            </div>

            <div className="reservation-options-summary-row">
              <span className="reservation-options-summary-label">
                <CalendarIcon /> 체크인/체크아웃
              </span>
              <span className="reservation-options-summary-value">
                {formatDateWithWeekday(search.checkIn)} - {formatDateWithWeekday(search.checkOut)} · {nights}박
              </span>
            </div>

            <div className="reservation-options-summary-row">
              <span className="reservation-options-summary-label">
                <PersonIcon /> 투숙인원
              </span>
              <span className="reservation-options-summary-value">
                총인원 {guests.adults + guests.children + guests.infants} · 성인 {guests.adults}, 어린이{' '}
                {guests.children}, 유아 {guests.infants}
              </span>
            </div>

            <div className="reservation-options-summary-row">
              <span className="reservation-options-summary-label">객실</span>
              <span className="reservation-options-summary-value">
                {roomStatus === 'loading' && '불러오는 중…'}
                {roomStatus === 'error' && '객실 정보를 불러오지 못했습니다'}
                {roomStatus === 'success' && room?.name}
              </span>
            </div>
          </div>

          <div className="reservation-options-summary-price">
            {priceStatus === 'loading' && <p className="reservation-options-summary-status">요금 조회 중…</p>}
            {priceStatus === 'error' && (
              <p className="reservation-options-summary-status error">요금 정보를 불러오지 못했습니다</p>
            )}

            {priceStatus === 'success' && (
              <>
                <ul className="reservation-options-summary-nights">
                  {nightlyPrices.map((day) => {
                    const date = parseDateISO(day.date)
                    return (
                      <li key={day.date}>
                        <span>{date ? formatDate(date) : day.date}</span>
                        <span>{day.price.toLocaleString()}원</span>
                      </li>
                    )
                  })}
                  {OPTIONS.filter((opt) => (optionCounts[opt.key] ?? 0) > 0).map((opt) => {
                    const count = optionCounts[opt.key] ?? 0
                    return (
                      <li key={opt.key}>
                        <span>
                          {opt.shortName} {count}인 이용
                        </span>
                        <span>{(opt.price * count).toLocaleString()}원</span>
                      </li>
                    )
                  })}
                </ul>

                <div className="reservation-options-summary-total">
                  <span className="reservation-options-summary-total-label">
                    요금합계
                    <br />
                    <span className="reservation-options-summary-total-note">부가가치세 포함</span>
                  </span>
                  <strong>{grandTotal.toLocaleString()}원</strong>
                </div>
              </>
            )}
          </div>

          <div className="reservation-options-summary-pay">
            <button
              type="button"
              className="reservation-options-pay-button"
              onClick={handleReserve}
              disabled={bookingStatus === 'submitting'}
            >
              {bookingStatus === 'submitting' ? '예약 생성 중…' : '예약하기'}
            </button>
            {bookingStatus === 'error' && (
              <p className="reservation-options-pay-status error">{bookingError}</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

export default ReservationOptionsPage
