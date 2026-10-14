import { Link } from 'react-router-dom'
import type { Hotel } from '../data/hotels'
import './HotelCard.css'

interface HotelCardProps {
  hotel: Hotel
}

function HotelCard({ hotel }: HotelCardProps) {
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
      </div>
    </Link>
  )
}

export default HotelCard
