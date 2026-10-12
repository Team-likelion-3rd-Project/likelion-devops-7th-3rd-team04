import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { HotelOutletContext } from '../layouts/HotelLayout'
import { fetchRooms } from '../api/hotels'
import type { Room } from '../api/hotels'
import RoomCard from '../components/RoomCard'
import './HotelStayPage.css'

type Status = 'loading' | 'success' | 'error'

function HotelStayPage() {
  const { hotel } = useOutletContext<HotelOutletContext>()
  const [status, setStatus] = useState<Status>('loading')
  const [rooms, setRooms] = useState<Room[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    fetchRooms(hotel.hotelId)
      .then((data) => {
        if (cancelled) return
        setRooms(data)
        setStatus('success')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '알 수 없는 오류')
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [hotel.hotelId])

  return (
    <section className="hotel-stay-page">
      <Link to={`/hotels/${hotel.id}`} className="hotel-back-link">
        ← {hotel.name}
      </Link>
      <h1>STAY</h1>
      <p className="hotel-stay-intro">{hotel.name}에서 만나볼 수 있는 객실 종류를 소개합니다.</p>

      {status === 'loading' && <p className="hotel-stay-status">객실 정보를 불러오는 중입니다…</p>}
      {status === 'error' && (
        <p className="hotel-stay-status error">객실 정보를 불러오지 못했습니다: {error}</p>
      )}
      {status === 'success' && rooms.length === 0 && (
        <p className="hotel-stay-status">현재 등록된 객실이 없습니다.</p>
      )}
      {status === 'success' && rooms.length > 0 && (
        <div className="hotel-stay-grid">
          {rooms.map((room) => (
            <RoomCard key={room.roomId} room={room} hotelSlug={hotel.id} />
          ))}
        </div>
      )}
    </section>
  )
}

export default HotelStayPage
