import { Link } from 'react-router-dom'
import type { Hotel } from '../data/hotels'
import './HotelCard.css'

interface HotelCardProps {
  hotel: Hotel
}

function HotelCard({ hotel }: HotelCardProps) {
  return (
    <Link to={`/hotels/${hotel.id}`} className="hotel-card">
      {/* TODO: accent 그라디언트를 실제 호텔 사진으로 교체 */}
      <div className="hotel-card-image" style={{ background: hotel.accent }} aria-hidden="true" />
      <div className="hotel-card-body">
        <p className="hotel-card-location">{hotel.location}</p>
        <h3 className="hotel-card-name">{hotel.name}</h3>
        <p className="hotel-card-summary">{hotel.summary}</p>
      </div>
    </Link>
  )
}

export default HotelCard
