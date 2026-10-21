import { useHotels } from '../data/hotelStore'
import HotelCard from '../components/HotelCard'
import './HotelsPage.css'

function HotelsPage() {
  // 호텔 이름·소개는 API(GET /api/hotels) 응답으로 갱신된다 (data/hotelStore.ts)
  const hotels = useHotels()
  return (
    <section className="hotels-page">
      <h1>호텔</h1>
      <div className="hotels-page-grid">
        {hotels.map((hotel) => (
          <HotelCard key={hotel.id} hotel={hotel} />
        ))}
      </div>
    </section>
  )
}

export default HotelsPage
