import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHotels } from '../data/hotelStore'
import DateRangeCalendar from '../components/reservation/DateRangeCalendar'
import GuestSelector from '../components/reservation/GuestSelector'
import ReservationSteps from '../components/reservation/ReservationSteps'
import { DEFAULT_ROOM_GUESTS, sumGuests } from '../components/reservation/guestTypes'
import type { RoomGuests } from '../components/reservation/guestTypes'
import { CalendarIcon, PersonIcon, PinIcon } from '../components/reservation/icons'
import { addDays, formatDateWithWeekday, startOfDay } from '../utils/date'
import { parseReservationSearchParams, toReservationSearchParams } from '../utils/reservationQuery'
import './ReservationPage.css'

type PanelKey = 'hotel' | 'dates' | 'guests' | null

function ReservationPage() {
  // 호텔 이름·소개는 API(GET /api/hotels) 응답으로 갱신된다 (data/hotelStore.ts)
  const hotels = useHotels()
  const navigate = useNavigate()
  const today = startOfDay(new Date())

  // 객실 선택 페이지에서 "재검색"/필드 클릭으로 돌아온 경우, 쿼리스트링에 실려온 이전 검색
  // 조건을 그대로 복원한다. 최초 진입(쿼리스트링 없음)이면 null이라 기본값을 그대로 쓴다.
  const [initialSearch] = useState(() => parseReservationSearchParams(new URLSearchParams(window.location.search)))

  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(initialSearch?.hotelSlug ?? null)
  const [checkIn, setCheckIn] = useState<Date | null>(initialSearch?.checkIn ?? today)
  const [checkOut, setCheckOut] = useState<Date | null>(initialSearch?.checkOut ?? addDays(today, 1))
  const [rooms, setRooms] = useState<RoomGuests[]>(initialSearch?.rooms ?? [{ ...DEFAULT_ROOM_GUESTS }])
  const [openPanel, setOpenPanel] = useState<PanelKey>(null)
  const [hotelFieldError, setHotelFieldError] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  const selectedHotel = hotels.find((h) => h.id === selectedHotelId) ?? null

  // 검색 바/패널 바깥을 클릭하면 열려있는 패널을 닫는다.
  useEffect(() => {
    if (!openPanel) return

    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenPanel(null)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [openPanel])

  const togglePanel = (key: PanelKey) => {
    setOpenPanel((prev) => (prev === key ? null : key))
  }

  const handleSelectHotel = (hotelId: string) => {
    setSelectedHotelId(hotelId)
    setHotelFieldError(false)
    // 패널은 닫지 않고 유지 — "날짜선택" 버튼으로 다음 단계(체크인/체크아웃)로 넘어간다.
  }

  const handleDateSelect = (nextCheckIn: Date, nextCheckOut: Date | null) => {
    setCheckIn(nextCheckIn)
    setCheckOut(nextCheckOut)
  }

  const { adults: totalAdults, children: totalChildren, infants: totalInfants } = sumGuests(rooms)

  // "객실 검색"을 누르면 이 페이지에서 바로 결과를 보여주는 대신, 조건을 쿼리스트링에 실어
  // 2단계(객실 선택) 페이지로 이동한다. 실제 GET /rooms/search 호출과 "예약 가능한 객실이
  // 없습니다" 안내는 그 2단계(RoomSelectionPage)에서 수행한다.
  const handleSearch = () => {
    if (!selectedHotel) {
      setOpenPanel('hotel')
      setHotelFieldError(true)
      return
    }
    if (!checkIn || !checkOut) {
      setOpenPanel('dates')
      return
    }

    setOpenPanel(null)
    const params = toReservationSearchParams({ hotelSlug: selectedHotel.id, checkIn, checkOut, rooms })
    navigate(`/reservation/rooms?${params.toString()}`)
  }

  const dateLabel = `${checkIn ? formatDateWithWeekday(checkIn) : '날짜 선택'} - ${
    checkOut ? formatDateWithWeekday(checkOut) : '날짜 선택'
  }`
  const guestLabel = `객실 ${rooms.length} · 성인 ${totalAdults} 어린이 ${totalChildren} 유아 ${totalInfants}`

  return (
    <section className="reservation-page">
      <div className="reservation-page-header">
        <h1>객실예약</h1>
        <ReservationSteps activeStep={0} />
      </div>

      <div className="reservation-search" ref={containerRef}>
        <div className="reservation-search-bar">
          <button
            type="button"
            className={`reservation-field ${openPanel === 'hotel' ? 'is-open' : ''}`}
            onClick={() => togglePanel('hotel')}
          >
            <span className="reservation-field-label">
              <PinIcon /> 호텔/지역
            </span>
            <span className="reservation-field-value">{selectedHotel ? selectedHotel.name : '호텔을 선택해주세요'}</span>
          </button>

          <span className="reservation-divider" aria-hidden="true" />

          <button
            type="button"
            className={`reservation-field ${openPanel === 'dates' ? 'is-open' : ''}`}
            onClick={() => togglePanel('dates')}
          >
            <span className="reservation-field-label">
              <CalendarIcon /> 체크인/체크아웃
            </span>
            <span className="reservation-field-value">{dateLabel}</span>
          </button>

          <span className="reservation-divider" aria-hidden="true" />

          <button
            type="button"
            className={`reservation-field ${openPanel === 'guests' ? 'is-open' : ''}`}
            onClick={() => togglePanel('guests')}
          >
            <span className="reservation-field-label">
              <PersonIcon /> 이용 인원
            </span>
            <span className="reservation-field-value">{guestLabel}</span>
          </button>

          <button type="button" className="reservation-search-submit" onClick={handleSearch}>
            객실 검색
          </button>
        </div>

        {openPanel === 'hotel' && (
          <div className="reservation-panel reservation-hotel-panel">
            {hotelFieldError && <p className="reservation-field-error">호텔을 먼저 선택해주세요.</p>}
            <ul className="reservation-hotel-list">
              {hotels.map((hotel) => (
                <li key={hotel.id}>
                  <button
                    type="button"
                    className={`reservation-hotel-option ${selectedHotelId === hotel.id ? 'is-selected' : ''}`}
                    onClick={() => handleSelectHotel(hotel.id)}
                  >
                    <span className="reservation-hotel-name">{hotel.name}</span>
                    <span className="reservation-hotel-location">{hotel.location}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="reservation-hotel-actions">
              <button
                type="button"
                className="reservation-hotel-next"
                disabled={!selectedHotel}
                onClick={() => setOpenPanel('dates')}
              >
                날짜선택
              </button>
            </div>
          </div>
        )}

        {openPanel === 'dates' && (
          <div className="reservation-panel">
            <DateRangeCalendar
              checkIn={checkIn}
              checkOut={checkOut}
              onSelect={handleDateSelect}
              onBack={() => setOpenPanel('hotel')}
              onConfirm={() => setOpenPanel('guests')}
            />
          </div>
        )}

        {openPanel === 'guests' && (
          <div className="reservation-panel">
            <GuestSelector
              rooms={rooms}
              onChange={setRooms}
              onBack={() => setOpenPanel('dates')}
              onSubmit={handleSearch}
            />
          </div>
        )}
      </div>
    </section>
  )
}

export default ReservationPage
