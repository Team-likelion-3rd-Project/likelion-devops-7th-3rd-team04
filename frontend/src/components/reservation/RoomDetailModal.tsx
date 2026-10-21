import { useEffect } from 'react'
import type { Room } from '../../api/hotels'
import RoomImageCarousel from '../RoomImageCarousel'
import './RoomDetailModal.css'

interface RoomDetailModalProps {
  room: Room
  onClose: () => void
}

/** 객실 선택 페이지에서 "상세보기"를 눌렀을 때 새 창 대신 띄우는 모달.
 * 이미 fetchRooms로 받아온 room 데이터를 그대로 보여주므로 추가 API 호출은 없다. */
function RoomDetailModal({ room, onClose }: RoomDetailModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="room-detail-modal-overlay" onClick={onClose}>
      <div
        className="room-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-detail-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="room-detail-modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>

        <h2 id="room-detail-modal-title" className="room-detail-modal-title">
          {room.name}
        </h2>

        {room.images.length > 0 ? (
          <RoomImageCarousel images={room.images} roomName={room.name} />
        ) : (
          <div className="room-detail-modal-image" aria-hidden="true" />
        )}

        <p className="room-detail-modal-capacity">기준 인원 {room.capacity}명</p>
        {room.description && <p className="room-detail-modal-description">{room.description}</p>}
      </div>
    </div>
  )
}

export default RoomDetailModal
