import { HOTELS } from '../data/hotels'
import HotelCard from '../components/HotelCard'
import './HotelsPage.css'

function HotelsPage() {
  return (
    <section className="hotels-page">
      <h1>호텔</h1>
      <div className="hotels-page-grid">
        {HOTELS.map((hotel) => (
          <HotelCard key={hotel.id} hotel={hotel} />
        ))}
      </div>
    </section>
  )
}

export default HotelsPage
