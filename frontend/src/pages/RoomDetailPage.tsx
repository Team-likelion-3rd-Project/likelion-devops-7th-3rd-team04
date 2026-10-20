import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import type { HotelOutletContext } from '../layouts/HotelLayout'
import { fetchRoom } from '../api/hotels'
import type { Room } from '../api/hotels'
import PlaceholderPage from '../components/PlaceholderPage'
import RoomImageCarousel from '../components/RoomImageCarousel'
import './RoomDetailPage.css'

type Status = 'loading' | 'success' | 'error'

function RoomDetailPage() {
  const { hotel } = useOutletContext<HotelOutletContext>()
  const { roomId } = useParams<{ roomId: string }>()
  const numericRoomId = Number(roomId)
  const isValidRoomId = roomId !== undefined && !Number.isNaN(numericRoomId)

  const [status, setStatus] = useState<Status>('loading')
  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isValidRoomId) return

    let cancelled = false

    fetchRoom(hotel.hotelId, numericRoomId)
      .then((data) => {
        if (cancelled) return
        setRoom(data)
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
  }, [hotel.hotelId, numericRoomId, isValidRoomId])

  // 404(존재하지 않는 객실 — roomId 형식 오류 포함)는 막다른 상세 페이지이므로 별도 안내 화면으로,
  // 그 외(네트워크/서버 오류 등)는 재시도 가능성을 알리는 인라인 메시지로 구분한다.
  const isNotFound = !isValidRoomId || (status === 'error' && error.startsWith('404'))

  return (
    <div className="room-detail-page">
      <Link to={`/hotels/${hotel.id}/stay`} className="hotel-back-link">
        ← STAY
      </Link>

      {isNotFound && (
        <PlaceholderPage
          title="객실을 찾을 수 없습니다"
          description={`${hotel.name}에 존재하지 않는 객실입니다.`}
        />
      )}
      {!isNotFound && status === 'loading' && (
        <p className="room-detail-status">객실 정보를 불러오는 중입니다…</p>
      )}
      {!isNotFound && status === 'error' && (
        <p className="room-detail-status error">객실 정보를 불러오지 못했습니다: {error}</p>
      )}
      {!isNotFound && status === 'success' && room && (
        <article className="room-detail">
          <h1 className="room-detail-title">{room.name}</h1>
          {room.images.length > 0 ? (
            <RoomImageCarousel images={room.images} roomName={room.name} />
          ) : (
            <div className="room-detail-image" aria-hidden="true" />
          )}
          <div className="room-detail-body">
            <p className="room-detail-capacity">기준 인원 {room.capacity}명</p>
            {/* description은 반드시 백엔드(GET /api/hotels/:hotelId/rooms/:roomId)에서 받아온 값을 그대로 표시한다 */}
            <p className="room-detail-description">{room.description}</p>
          </div>
        </article>
      )}
    </div>
  )
}

export default RoomDetailPage
