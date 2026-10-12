import seoulHero from '../assets/images/hotels/seoul/hero.jpg'
import seoulStay from '../assets/images/hotels/seoul/stay.jpg'
import seoulWaters from '../assets/images/hotels/seoul/waters.jpg'
import busanHero from '../assets/images/hotels/busan/hero.jpg'
import busanStay from '../assets/images/hotels/busan/stay.jpg'
import busanWaters from '../assets/images/hotels/busan/waters.jpg'

// TODO: 실제 데이터가 준비되면 api-gateway(/api/hotels)에서 가져오도록 교체
export interface Hotel {
  id: string
  /** hotel-service(백엔드)의 실제 PK. 객실 조회 등 gRPC 연동 API 호출 시 이 숫자 ID를 사용한다. */
  hotelId: number
  name: string
  location: string
  summary: string
  /** 실사진이 준비되기 전까지 카드/히어로에 쓸 플레이스홀더 그라디언트 */
  accent: string
  /** 실사진이 준비된 슬롯만 채운다. 비어있는 슬롯은 accent 그라디언트로 대체 렌더링된다. */
  images: {
    hero?: string
    stay?: string
    /** HotelDetailPage의 WATERS 타일과 HotelWatersPage 히어로가 함께 사용 */
    waters?: string
  }
}

export const HOTELS: Hotel[] = [
  {
    id: 'seoul',
    hotelId: 1,
    name: '서울점',
    location: '서울 강남구',
    summary: '도심 속에서 누리는 조용한 휴식',
    accent: 'linear-gradient(135deg, #3a3226, #6b5a3d)',
    images: { hero: seoulHero, stay: seoulStay, waters: seoulWaters },
  },
  {
    id: 'busan',
    hotelId: 2,
    name: '부산점',
    location: '부산 해운대구',
    summary: '오션뷰와 함께하는 여유로운 시간',
    accent: 'linear-gradient(135deg, #24343a, #3d6b6a)',
    images: { hero: busanHero, stay: busanStay, waters: busanWaters },
  },
  {
    id: 'jeju',
    hotelId: 3,
    name: '제주점',
    location: '제주 서귀포시',
    summary: '자연 속 프라이빗한 힐링 스테이',
    accent: 'linear-gradient(135deg, #2f3a26, #5a6b3d)',
    // 사진 미제공 — accent 그라디언트로 대체 표시됨
    images: {},
  },
]
