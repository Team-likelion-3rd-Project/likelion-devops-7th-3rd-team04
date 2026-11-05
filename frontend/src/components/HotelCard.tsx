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
  /** 카드 위 제목이 h1이면 2, h2면 3 — 제목 단계를 건너뛰지 않게 한다 (LDP-222) */
  headingLevel?: 2 | 3
  /** 첫 화면 밖 카드면 사진을 화면에 가까워질 때 불러온다 */
  lazyImage?: boolean
}

function HotelCard({ hotel, headingLevel = 3, lazyImage = false }: HotelCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
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
      {/* 대표 사진이 있으면 사진, 없으면(또는 불러오는 동안) 호텔별 accent 그라디언트를 보여준다. */}
      <div className="hotel-card-image" style={{ backgroundImage: hotel.accent }} aria-hidden="true">
        {hotel.images.hero && (
          <img
            src={hotel.images.hero}
            alt=""
            width={1600}
            height={700}
            loading={lazyImage ? 'lazy' : undefined}
            decoding="async"
          />
        )}
      </div>
      <div className="hotel-card-body">
        <p className="hotel-card-location">{hotel.location}</p>
        <Heading className="hotel-card-name">{hotel.name}</Heading>
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
