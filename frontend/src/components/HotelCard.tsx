import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { searchRooms } from '../api/hotels'
import type { Hotel } from '../data/hotels'
import { addDays, formatDateISO, startOfDay } from '../utils/date'
import './HotelCard.css'

// 최저가를 찾을 기간 — 오늘부터 7박이라 평일 요금이 항상 들어간다 (주말은 평일 +20%, LDP-174)
const MIN_PRICE_NIGHTS = 7

interface HotelCardProps {
  hotel: Hotel
}

function HotelCard({ hotel }: HotelCardProps) {
  // 1박 최저가 — 기간 중 예약 가능한 객실의 가장 싼 1박 요금. 못 불러오면 가격 줄을 보여주지 않는다.
  const [minPrice, setMinPrice] = useState<number | null>(null)

  useEffect(() => {
    let ignore = false
    const today = startOfDay(new Date())
    searchRooms(hotel.hotelId, formatDateISO(today), formatDateISO(addDays(today, MIN_PRICE_NIGHTS)), 1)
      .then((results) => {
        if (!ignore && results.length > 0) setMinPrice(Math.min(...results.map((result) => result.minPrice)))
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [hotel.hotelId])

  return (
    <Link to={`/hotels/${hotel.id}`} className="hotel-card">
      {/* 대표 사진이 있으면 사진, 없으면 호텔별 accent 그라디언트를 보여준다. */}
      <div
        className="hotel-card-image"
        style={{
          backgroundImage: hotel.images.hero ? `url(${hotel.images.hero}), ${hotel.accent}` : hotel.accent,
        }}
        aria-hidden="true"
      />
      <div className="hotel-card-body">
        <p className="hotel-card-location">{hotel.location}</p>
        <h3 className="hotel-card-name">{hotel.name}</h3>
        <p className="hotel-card-summary">{hotel.summary}</p>
        {minPrice !== null && (
          <p className="hotel-card-price">
            1박 <strong>{minPrice.toLocaleString()}원</strong>~
          </p>
        )}
      </div>
    </Link>
  )
}

export default HotelCard
