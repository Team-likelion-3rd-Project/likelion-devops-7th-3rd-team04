// 호텔·객실·부대시설·공지 원본 데이터 — DB 시딩(seed.ts)과 챗봇 RAG 문서(export-rag-catalog.ts)가 함께 쓴다.
// 여기를 바꾸면 `npm run rag:export-catalog`로 langchain_rag/llm-service/app/rag_catalog.json을 다시 만들어야
// 한다 (scripts/export-rag-catalog.spec.ts가 CI에서 일치 여부를 검사).
// 엔티티는 타입으로만 쓴다 — import해도 DB 연결 등 부작용이 없어야 export 스크립트·spec이 가볍게 돈다.
import type { Facility } from '../apps/hotel-service/src/entities/facility.entity';
import type { Hotel } from '../apps/hotel-service/src/entities/hotel.entity';
import type { RoomType } from '../apps/hotel-service/src/entities/room-type.entity';

// 주말(금·토 밤 숙박) 요금 = 평일 요금 × 1.2 (LDP-174, 10-26 요금표)
export const WEEKEND_PRICE_RATE = 1.2;

// booking-service.service.ts의 FACILITY_NAME_INDOOR_POOL/FACILITY_NAME_LOUNGE 상수와
// name이 정확히 일치해야 createBooking의 편의시설 요금 조회(이름 매칭)가 성공합니다.
export const FACILITY_SEEDS: Pick<Facility, 'name' | 'price'>[] = [
  { name: '수영장', price: 77000 },
  { name: '수영장 소인', price: 44000 },
  { name: '라운지', price: 80000 },
  { name: '라운지 소인', price: 30000 },
];

// 첫 공지 (LDP-147) — 프론트가 직접 적어 두던 frontend/src/data/notices.ts의 6건 그대로.
// date는 작성일(created_at)로 넣는다 (한국 날짜가 같게 보이도록 UTC 자정).
export const NOTICE_SEEDS: {
  date: string;
  category: 'NOTICE' | 'EVENT' | 'MAINTENANCE';
  title: string;
  body: string;
  pinned: boolean;
}[] = [
  {
    date: '2026-10-01',
    category: 'NOTICE',
    title: '머묾 온라인 예약 오픈',
    body: '서울점·부산점·제주점의 객실을 홈페이지에서 바로 예약하고 결제할 수 있습니다. 예약 내역과 결제 내역은 마이페이지에서 확인하세요.',
    pinned: false,
  },
  {
    date: '2026-10-05',
    category: 'NOTICE',
    title: '제주점 라운지 리뉴얼 오픈',
    body: '제주점 라운지가 새 단장을 마치고 문을 열었습니다. 오름이 보이는 창가 좌석과 지역 재료로 만든 다과를 준비했습니다.',
    pinned: false,
  },
  {
    date: '2026-10-10',
    category: 'MAINTENANCE',
    title: '예약 시스템 점검 안내 (10월 12일 02:00~04:00)',
    body: '더 안정적인 서비스를 위해 시스템 점검을 진행합니다. 점검 시간에는 예약·결제가 잠시 중단되며, 이미 완료된 예약에는 영향이 없습니다.',
    pinned: false,
  },
  {
    date: '2026-10-15',
    category: 'EVENT',
    title: '가을 시즌 수영장 야간 운영 연장',
    body: '10월 한 달 동안 세 지점 수영장을 밤 11시까지 운영합니다. 예약 시 수영장 옵션을 선택하시면 이용하실 수 있습니다.',
    pinned: false,
  },
  {
    date: '2026-10-20',
    category: 'NOTICE',
    title:
      '결제 기한 안내 — 결제 대기 예약은 기한이 지나면 자동으로 만료됩니다',
    body: '오늘 체크인하는 예약은 예약 후 30분, 내일 이후 체크인하는 예약은 체크인 전날 자정까지 결제해 주세요. 기한은 마이페이지의 예약 상세와 결제 대기 화면에서 확인할 수 있습니다.',
    pinned: true,
  },
  {
    date: '2026-10-23',
    category: 'NOTICE',
    title: '호텔 브랜드명이 "머묾(MEOMULM)"으로 바뀌었습니다',
    body: '머무는 순간을 온전히 손님의 시간으로 만들겠다는 뜻을 담아, 브랜드명을 "머묾"으로 정했습니다. 예약 내역과 회원 정보는 그대로 이용하실 수 있습니다.',
    pinned: true,
  },
];

// 객실 설명 원재료. seed.ts의 describeRoom()이 DB rooms.description 문자열로, RAG 문서는 항목별로 쓴다.
export interface RoomDetail {
  intro: string;
  bedroomCount: number;
  bedConfig: string;
  maxGuests: number;
  amenities: string[];
}

export interface HotelSeed {
  // slug: 챗봇이 쓰는 지점·객실 식별자 (RAG 문서 id, 예약 딥링크의 hotel 값 — chat-action.ts HOTEL_SLUGS). DB에는 넣지 않는다
  slug: string;
  hotel: Pick<Hotel, 'name' | 'address' | 'phoneNumber' | 'description'>;
  // images: scripts/seed-images/ 안의 사진 파일 이름 (배열 순서 = 노출 순서, 첫 번째가 대표 사진) — seedRoomImages()
  // weekdayPrice: 평일(일~목 밤 숙박) 1박 요금 — 주말은 WEEKEND_PRICE_RATE를 곱한다 (LDP-174)
  rooms: (Pick<RoomType, 'name' | 'capacity' | 'totalCount'> & {
    slug: string;
    images: string[];
    weekdayPrice: number;
    detail: RoomDetail;
  })[];
}

// 호텔당 객실 타입 4개, 타입별 보유 수량(totalCount)을 합쳐 호텔당 방 20개 · 전체 60개 (LDP-62).
// rooms 한 줄 = 객실 타입이라, 같은 날짜에 보유 수량만큼 예약을 받는다 — 성능 테스트나 여러 명이 동시에
// 테스트해도 금방 매진되지 않게 하려는 것 (60개 × 365일 = 21,900박).
//
// hotelId가 1/2/3 순서로 생성되도록(빈 테이블 기준 auto_increment) 배열 순서를 유지합니다.
// frontend/src/data/hotels.ts의 하드코딩 배열(서울점=1, 부산점=2, 제주점=3)과 맞물립니다.
export const HOTEL_SEEDS: HotelSeed[] = [
  {
    slug: 'seoul',
    hotel: {
      name: '서울점',
      address: '서울 강남구 테헤란로 123',
      phoneNumber: '02-1234-5678',
      description: '도심 속에서 누리는 조용한 휴식',
    },
    rooms: [
      {
        slug: 'deluxe-double',
        name: '디럭스 더블룸',
        weekdayPrice: 120000,
        images: [
          '01-seoul-deluxe-double-1.jpg',
          '01-seoul-deluxe-double-2.jpg',
        ],
        capacity: 2,
        totalCount: 10,
        detail: {
          intro: '시티뷰를 갖춘 넓은 더블룸입니다.',
          bedroomCount: 1,
          bedConfig: '킹사이즈 베드 1개',
          maxGuests: 2,
          amenities: [
            '무료 Wi-Fi',
            '43인치 스마트 TV',
            '미니바',
            '캡슐 커피머신',
            '헤어드라이어',
            '다리미',
            '전자 금고',
            '욕실 어메니티(샴푸·린스·바디워시)',
          ],
        },
      },
      {
        slug: 'standard-twin',
        name: '스탠다드 트윈룸',
        weekdayPrice: 100000,
        images: [
          '02-seoul-standard-twin-1.jpg',
          '02-seoul-standard-twin-2.jpg',
        ],
        capacity: 2,
        totalCount: 5,
        detail: {
          intro: '실용적인 구성의 스탠다드 트윈룸입니다.',
          bedroomCount: 1,
          bedConfig: '싱글사이즈 베드 2개',
          maxGuests: 2,
          amenities: ['무료 Wi-Fi', '32인치 TV', '냉장고', '전기 주전자', '헤어드라이어', '욕실 어메니티'],
        },
      },
      {
        slug: 'premier-suite',
        name: '프리미어 스위트룸',
        weekdayPrice: 150000,
        images: [
          '03-seoul-premier-suite-1.jpg',
          '03-seoul-premier-suite-2.jpg',
        ],
        capacity: 3,
        totalCount: 2,
        detail: {
          intro: '넓은 거실 공간을 갖춘 프리미어 스위트룸입니다.',
          bedroomCount: 1,
          bedConfig: '킹사이즈 베드 1개 + 별도 거실의 소파베드 1개',
          maxGuests: 3,
          amenities: [
            '무료 Wi-Fi',
            '55인치 스마트 TV',
            '미니바',
            '네스프레소 머신',
            '욕조',
            '가운 & 슬리퍼',
            '전자 금고',
            '다리미',
          ],
        },
      },
      {
        slug: 'family',
        name: '패밀리룸',
        weekdayPrice: 150000,
        images: ['04-seoul-family-1.jpg', '04-seoul-family-2.jpg'],
        capacity: 4,
        totalCount: 3,
        detail: {
          intro: '가족 단위 투숙객을 위한 넉넉한 패밀리룸입니다.',
          bedroomCount: 2,
          bedConfig: '퀸사이즈 베드 1개 + 싱글사이즈 베드 2개',
          maxGuests: 4,
          amenities: [
            '무료 Wi-Fi',
            '객실별 TV 2대',
            '냉장고',
            '전자레인지',
            '헤어드라이어',
            '아기 침대 요청 가능',
            '욕실 어메니티',
          ],
        },
      },
    ],
  },
  {
    slug: 'busan',
    hotel: {
      name: '부산점',
      address: '부산 해운대구 해운대해변로 264',
      phoneNumber: '051-1234-5678',
      description: '오션뷰와 함께하는 여유로운 시간',
    },
    rooms: [
      {
        slug: 'oceanview-suite',
        name: '오션뷰 스위트룸',
        weekdayPrice: 170000,
        images: [
          '05-busan-oceanview-suite-1.jpg',
          '05-busan-oceanview-suite-2.jpg',
        ],
        capacity: 2,
        totalCount: 5,
        detail: {
          intro: '탁 트인 오션뷰를 자랑하는 스위트룸입니다.',
          bedroomCount: 1,
          bedConfig: '킹사이즈 베드 1개 + 별도 거실',
          maxGuests: 2,
          amenities: [
            '오션뷰 발코니',
            '무료 Wi-Fi',
            '스마트 TV',
            '미니바',
            '욕조',
            '캡슐 커피머신',
            '가운 & 슬리퍼',
          ],
        },
      },
      {
        slug: 'standard-double',
        name: '스탠다드 더블룸',
        weekdayPrice: 90000,
        images: [
          '06-busan-standard-double-1.jpg',
          '06-busan-standard-double-2.jpg',
        ],
        capacity: 2,
        totalCount: 5,
        detail: {
          intro: '아늑한 구성의 스탠다드 더블룸입니다.',
          bedroomCount: 1,
          bedConfig: '더블사이즈 베드 1개',
          maxGuests: 2,
          amenities: ['무료 Wi-Fi', 'TV', '냉장고', '헤어드라이어', '욕실 어메니티'],
        },
      },
      {
        slug: 'premium-oceanview',
        name: '프리미엄 오션뷰룸',
        weekdayPrice: 150000,
        images: [
          '07-busan-premium-oceanview-1.jpg',
          '07-busan-premium-oceanview-2.jpg',
        ],
        capacity: 3,
        totalCount: 5,
        detail: {
          intro: '파노라마 오션뷰를 즐길 수 있는 프리미엄룸입니다.',
          bedroomCount: 1,
          bedConfig: '킹사이즈 베드 1개 + 싱글 소파베드 1개',
          maxGuests: 3,
          amenities: [
            '통유리 오션뷰 창',
            '전용 발코니',
            '무료 Wi-Fi',
            '스마트 TV',
            '미니바',
            '캡슐 커피머신',
            '욕조',
          ],
        },
      },
      {
        slug: 'family-twin',
        name: '패밀리 트윈룸',
        weekdayPrice: 140000,
        images: ['08-busan-family-twin-1.jpg', '08-busan-family-twin-2.jpg'],
        capacity: 4,
        totalCount: 5,
        detail: {
          intro: '가족 여행객을 위한 넓은 패밀리 트윈룸입니다.',
          bedroomCount: 2,
          bedConfig: '더블사이즈 베드 1개 + 싱글사이즈 베드 2개',
          maxGuests: 4,
          amenities: [
            '오션뷰 발코니',
            '무료 Wi-Fi',
            '객실별 TV 2대',
            '냉장고',
            '전자레인지',
            '욕실 어메니티',
          ],
        },
      },
    ],
  },
  {
    slug: 'jeju',
    hotel: {
      name: '제주점',
      address: '제주 서귀포시 중문관광로72번길 100',
      phoneNumber: '064-1234-5678',
      description: '자연 속 프라이빗한 힐링 스테이',
    },
    rooms: [
      {
        slug: 'gardenview-twin',
        name: '가든뷰 트윈룸',
        weekdayPrice: 110000,
        images: [
          '09-jeju-gardenview-twin-1.jpg',
          '09-jeju-gardenview-twin-2.jpg',
        ],
        capacity: 2,
        totalCount: 5,
        detail: {
          intro: '아늑한 정원 전망의 트윈룸입니다.',
          bedroomCount: 1,
          bedConfig: '싱글사이즈 베드 2개',
          maxGuests: 2,
          amenities: ['정원뷰 창', '무료 Wi-Fi', 'TV', '냉장고', '헤어드라이어', '욕실 어메니티'],
        },
      },
      {
        slug: 'standard-double',
        name: '스탠다드 더블룸',
        weekdayPrice: 90000,
        images: [
          '10-jeju-standard-double-1.jpg',
          '10-jeju-standard-double-2.jpg',
        ],
        capacity: 2,
        totalCount: 10,
        detail: {
          intro: '제주의 자연을 가까이 느낄 수 있는 스탠다드룸입니다.',
          bedroomCount: 1,
          bedConfig: '더블사이즈 베드 1개',
          maxGuests: 2,
          amenities: ['무료 Wi-Fi', 'TV', '냉장고', '전기 주전자', '욕실 어메니티'],
        },
      },
      {
        slug: 'private-poolvilla',
        name: '프라이빗 풀빌라룸',
        weekdayPrice: 250000,
        images: [
          '11-jeju-private-poolvilla-1.jpg',
          '11-jeju-private-poolvilla-2.jpg',
        ],
        capacity: 3,
        totalCount: 3,
        detail: {
          intro: '독립적인 야외 풀을 갖춘 프라이빗 풀빌라룸입니다.',
          bedroomCount: 1,
          bedConfig: '킹사이즈 베드 1개',
          maxGuests: 3,
          amenities: [
            '프라이빗 야외 수영장',
            '전용 테라스',
            '무료 Wi-Fi',
            '스마트 TV',
            '미니바',
            '가운 & 슬리퍼',
          ],
        },
      },
      {
        slug: 'family-suite',
        name: '패밀리 스위트룸',
        weekdayPrice: 170000,
        images: ['12-jeju-family-suite-1.jpg', '12-jeju-family-suite-2.jpg'],
        capacity: 4,
        totalCount: 2,
        detail: {
          intro: '넓은 공간의 패밀리 스위트룸입니다.',
          bedroomCount: 2,
          bedConfig: '퀸사이즈 베드 1개 + 싱글사이즈 베드 2개',
          maxGuests: 4,
          amenities: [
            '정원뷰 테라스',
            '무료 Wi-Fi',
            '객실별 TV 2대',
            '냉장고',
            '전자레인지 & 전기 주전자',
            '욕실 어메니티',
          ],
        },
      },
    ],
  },
];
