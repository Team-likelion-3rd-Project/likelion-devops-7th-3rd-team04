import { useState } from 'react'
import type { RoomImage } from '../api/hotels'
import './RoomImageCarousel.css'

interface RoomImageCarouselProps {
  images: RoomImage[]
  roomName: string
  className?: string
}

// 객실 사진을 한 장씩 보여주고 이전/다음 버튼으로 넘긴다 (객실 상세 페이지·예약 객실 모달 공용).
// 사진이 1장이면 버튼·번호 없이 사진만 보여준다. 끝에서 다음을 누르면 처음으로 돌아간다.
function RoomImageCarousel({ images, roomName, className }: RoomImageCarouselProps) {
  const [index, setIndex] = useState(0)
  // 사진 목록이 바뀌어(다른 객실) 현재 번호가 범위를 벗어나면 첫 장을 보여준다
  const current = index < images.length ? index : 0
  const hasMultiple = images.length > 1

  const show = (next: number) => setIndex((next + images.length) % images.length)

  return (
    <div className={['room-carousel', className].filter(Boolean).join(' ')}>
      <img
        key={images[current].imageId}
        className="room-carousel-image"
        src={images[current].imageUrl}
        alt={`${roomName} 사진 ${current + 1}`}
      />
      {hasMultiple && (
        <>
          <button
            type="button"
            className="room-carousel-button prev"
            onClick={() => show(current - 1)}
            aria-label="이전 사진"
          >
            ‹
          </button>
          <button
            type="button"
            className="room-carousel-button next"
            onClick={() => show(current + 1)}
            aria-label="다음 사진"
          >
            ›
          </button>
          <span className="room-carousel-counter">
            {current + 1} / {images.length}
          </span>
          <div className="room-carousel-dots">
            {images.map((image, i) => (
              <button
                key={image.imageId}
                type="button"
                className={`room-carousel-dot${i === current ? ' active' : ''}`}
                onClick={() => setIndex(i)}
                aria-label={`${i + 1}번째 사진 보기`}
                aria-current={i === current}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default RoomImageCarousel
