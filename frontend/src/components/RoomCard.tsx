import { Link } from 'react-router-dom'
import type { Room } from '../api/hotels'
import './RoomCard.css'

interface RoomCardProps {
  room: Room
  /** 라우팅용 호텔 slug (mock hotels.ts의 문자열 id) */
  hotelSlug: string
}

function RoomCard({ room, hotelSlug }: RoomCardProps) {
  // images는 sortOrder 오름차순으로 내려오므로 0번째가 대표 이미지
  const thumbnail = room.images[0]

  return (
    <Link to={`/hotels/${hotelSlug}/rooms/${room.roomId}`} className="room-card">
      {thumbnail ? (
        <img
          className="room-card-image"
          src={thumbnail.imageUrl}
          alt={room.name}
        />
      ) : (
        <div className="room-card-image" aria-hidden="true" />
      )}
      <div className="room-card-body">
        <h3 className="room-card-name">{room.name}</h3>
        <p className="room-card-capacity">기준 인원 {room.capacity}명</p>
      </div>
    </Link>
  )
}

export default RoomCard
