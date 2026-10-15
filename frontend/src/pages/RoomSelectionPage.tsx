import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useHotels } from '../data/hotelStore'
import { searchRooms, toImageDataUrl } from '../api/hotels'
import type { Room, RoomSearchResult } from '../api/hotels'
import ReservationSteps from '../components/reservation/ReservationSteps'
import RoomDetailModal from '../components/reservation/RoomDetailModal'
import { sumGuests } from '../components/reservation/guestTypes'
import { CalendarIcon, PersonIcon, PinIcon, RefreshIcon } from '../components/reservation/icons'
import { diffDays, formatDateISO, formatDateWithWeekday } from '../utils/date'
import { parseReservationSearchParams, toReservationSearchParams } from '../utils/reservationQuery'
import './RoomSelectionPage.css'

type ListStatus = 'loading' | 'success' | 'error'

type SortOrder = 'price-asc' | 'price-desc'

function RoomSelectionPage() {
  // 호텔 이름·소개는 API(GET /api/hotels) 응답으로 갱신된다 (data/hotelStore.ts)
  const hotels = useHotels()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // 1단계(호텔/날짜/투숙인원 선택)에서 쿼리스트링으로 실어 보낸 검색 조건.
  const search = useMemo(() => parseReservationSearchParams(searchParams), [searchParams])
  const hotel = search ? hotels.find((h) => h.id === search.hotelSlug) ?? null : null

  // GET /rooms/search 결과 — capacity가 투숙 인원 이상이고 지정 기간 동안 예약 가능한 객실만 담겨
  // 있으므로, 목록에 뜨는 객실은 전부 바로 "선택" 가능하다(별도 가용성 재확인이 필요 없다).
  const [results, setResults] = useState<RoomSearchResult[]>([])
  const [resultsStatus, setResultsStatus] = useState<ListStatus>('loading')
  const [resultsError, setResultsError] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('price-asc')
  const [detailRoom, setDetailRoom] = useState<Room | null>(null)

  // 검색 조건이 없거나 (예: 페이지 직접 접근) 존재하지 않는 호텔이면 1단계로 돌려보낸다.
  useEffect(() => {
    if (!search || !hotel) {
      navigate('/reservation', { replace: true })
    }
  }, [search, hotel, navigate])

  useEffect(() => {
    if (!search || !hotel) return
    let cancelled = false

    // 유아를 포함한 총인원 — ReservationPage의 검색 버튼과 동일한 기준으로 room.capacity와 비교한다.
    const guests = sumGuests(search.rooms)
    const totalGuests = guests.adults + guests.children + guests.infants

    searchRooms(hotel.hotelId, formatDateISO(search.checkIn), formatDateISO(search.checkOut), totalGuests)
      .then((data) => {
        if (cancelled) return
        setResults(data)
        setResultsStatus('success')
      })
      .catch((err) => {
        if (cancelled) return
        setResultsStatus('error')
        setResultsError(err instanceof Error ? err.message : '알 수 없는 오류')
      })

    return () => {
      cancelled = true
    }
  }, [search, hotel])

  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) =>
      sortOrder === 'price-asc' ? a.minPrice - b.minPrice : b.minPrice - a.minPrice,
    )
  }, [results, sortOrder])

  // "선택"한 객실 정보까지 실어서 다음 단계(옵션 선택)로 이동한다.
  const handleSelectRoom = (room: Room) => {
    if (!search) return
    const params = toReservationSearchParams(search)
    params.set('room', String(room.roomId))
    navigate(`/reservation/options?${params.toString()}`)
  }

  if (!search || !hotel) {
    // useEffect가 /reservation으로 돌려보내는 동안 잠깐 보여줄 빈 화면
    return null
  }

  const nights = diffDays(search.checkOut, search.checkIn)
  const guests = sumGuests(search.rooms)
  const backToSearchUrl = `/reservation?${toReservationSearchParams(search).toString()}`

  return (
    <section className="room-selection-page">
      <div className="reservation-page-header">
        <h1>객실예약</h1>
        <ReservationSteps activeStep={1} />
      </div>

      <div className="room-selection-body">
        <div className="room-selection-main">
          <div className="room-selection-toolbar">
            <p className="room-selection-count">
              {resultsStatus === 'success' ? `${hotel.name} · 예약 가능 ${results.length}개 객실` : hotel.name}
            </p>
            <label className="room-selection-sort">
              정렬
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as SortOrder)}>
                <option value="price-asc">낮은가격순</option>
                <option value="price-desc">높은가격순</option>
              </select>
            </label>
          </div>

          {resultsStatus === 'loading' && <p className="room-selection-status">객실 정보를 불러오는 중입니다…</p>}
          {resultsStatus === 'error' && (
            <p className="room-selection-status error">객실 정보를 불러오지 못했습니다: {resultsError}</p>
          )}
          {resultsStatus === 'success' && sortedResults.length === 0 && (
            <p className="room-selection-status">예약 가능한 객실이 없습니다.</p>
          )}

          {resultsStatus === 'success' && sortedResults.length > 0 && (
            <ul className="room-select-list">
              {sortedResults.map(({ room, minPrice }) => {
                const thumbnail = room.images[0]

                return (
                  <li className="room-select-card" key={room.roomId}>
                    {thumbnail ? (
                      <img className="room-select-thumb" src={toImageDataUrl(thumbnail)} alt={room.name} />
                    ) : (
                      <div className="room-select-thumb is-placeholder" aria-hidden="true" />
                    )}

                    <div className="room-select-body">
                      <div className="room-select-heading">
                        <h3 className="room-select-name">{room.name}</h3>
                        <button
                          type="button"
                          className="room-select-detail-link"
                          onClick={() => setDetailRoom(room)}
                        >
                          상세보기 ›
                        </button>
                      </div>
                      <p className="room-select-capacity">기준 인원 {room.capacity}명</p>

                      <div className="room-select-inline-price">
                        <p>
                          최저가 <strong>{minPrice.toLocaleString()}원~</strong>
                          <span className="room-select-price-unit">{nights}박</span>
                        </p>
                      </div>
                    </div>

                    <button type="button" className="room-select-button" onClick={() => handleSelectRoom(room)}>
                      선택
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <aside className="room-selection-summary">
          <div className="room-selection-summary-header">
            <Link className="room-selection-refresh" to={backToSearchUrl}>
              <RefreshIcon /> 재검색
            </Link>
          </div>

          <div className="room-selection-summary-info">
            <div className="room-selection-summary-row">
              <span className="room-selection-summary-label">
                <PinIcon /> 호텔/지역
              </span>
              <span className="room-selection-summary-value">{hotel.name}</span>
            </div>

            <div className="room-selection-summary-row">
              <span className="room-selection-summary-label">
                <CalendarIcon /> 체크인/체크아웃
              </span>
              <span className="room-selection-summary-value">
                {formatDateWithWeekday(search.checkIn)} - {formatDateWithWeekday(search.checkOut)} · {nights}박
              </span>
            </div>

            <div className="room-selection-summary-row">
              <span className="room-selection-summary-label">
                <PersonIcon /> 투숙인원
              </span>
              <span className="room-selection-summary-value">
                총인원 {guests.adults + guests.children + guests.infants} · 성인 {guests.adults}, 어린이{' '}
                {guests.children}, 유아 {guests.infants}
              </span>
            </div>
          </div>
        </aside>
      </div>

      {detailRoom && <RoomDetailModal room={detailRoom} onClose={() => setDetailRoom(null)} />}
    </section>
  )
}

export default RoomSelectionPage
