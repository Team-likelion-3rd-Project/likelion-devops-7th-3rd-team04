import { Outlet, useParams } from 'react-router-dom'
import { useHotels } from '../data/hotelStore'
import type { Hotel } from '../data/hotels'
import PlaceholderPage from '../components/PlaceholderPage'
import './HotelLayout.css'

export interface HotelOutletContext {
  hotel: Hotel
}

/**
 * `/hotels/:hotelId` 하위 전체 라우트(index/stay/rooms/:roomId/waters)를 감싸는 레이아웃.
 * slug 기반 hotel 조회와 "존재하지 않는 호텔" 처리를 여기서 한 번만 담당하고,
 * 자식 페이지들은 useOutletContext로 이미 확인된 hotel을 그대로 사용한다.
 */
function HotelLayout() {
  // 호텔 이름·소개는 API(GET /api/hotels) 응답으로 갱신된다 (data/hotelStore.ts)
  const hotels = useHotels()
  const { hotelId } = useParams<{ hotelId: string }>()
  const hotel = hotels.find((h) => h.id === hotelId)

  if (!hotel) {
    return <PlaceholderPage title="호텔을 찾을 수 없습니다" />
  }

  // 폭 제약(max-width/padding)은 페이지마다 다르게 필요하므로(예: HotelDetailPage의 풀블리드 히어로)
  // 여기서는 강제하지 않고 각 하위 페이지가 자신의 컨테이너를 직접 소유한다.
  return <Outlet context={{ hotel } satisfies HotelOutletContext} />
}

export default HotelLayout
