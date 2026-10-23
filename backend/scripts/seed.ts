import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Between, DataSource, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Admin } from '../apps/user-service/src/admin/entities/admin.entity';
import { AdminCredential } from '../apps/auth-service/src/entities/admin-credential.entity';
import { Hotel } from '../apps/hotel-service/src/entities/hotel.entity';
import { RoomType } from '../apps/hotel-service/src/entities/room-type.entity';
import {
  RoomUnit,
  RoomUnitStatus,
} from '../apps/hotel-service/src/entities/room-unit.entity';
import { RoomAvailability } from '../apps/hotel-service/src/entities/room-availability.entity';
import { RoomImage } from '../apps/hotel-service/src/entities/room-image.entity';
import { Facility } from '../apps/hotel-service/src/entities/facility.entity';
import { mariaDbSslOptions } from '../libs/common/src/db/mariadb-ssl';

// docker compose 기동 시(db-seed 서비스, scripts/Dockerfile.seed) 1회 실행되는 시딩 스크립트입니다.
// NestFactory 대신 TypeORM DataSource를 직접 열어 admins/admin_credentials/hotels/rooms/facilities에
// 필요한 초기 데이터를 넣습니다 — hotel-service에는 CreateHotel API가, auth-service에는
// 관리자 자격증명을 만드는 API가 아직 없어서(테스트 편의를 위한 시딩 목적상) 직접 DB에
// insert하는 방식을 택했습니다. 기존 서비스가 소유한 엔티티 클래스를 그대로 재사용합니다.
// 매번 재실행해도 안전하도록(멱등) 이미 존재하면 건너뜁니다. 예약 가능일 달력만은 재실행할 때마다
// 빠진 날짜를 채워서 기간이 계속 연장됩니다(기존 날짜·예약 수는 그대로).

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = Number(process.env.DB_PORT ?? 3306);
const DB_USERNAME = process.env.DB_USERNAME ?? 'root';
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_DATABASE = process.env.DB_DATABASE;

// admin_credentials 해시 방식은 auth-service.service.ts의 SALT_ROUNDS와 동일하게 맞춥니다.
const SALT_ROUNDS = 10;

// room_availabilities 시딩 시 기본 가격 — hotel-service 스펙 테스트(hotel-service.controller.spec.ts)의
// 예시 값과 동일하게 맞춥니다.
const DEFAULT_ROOM_PRICE = 100000;

// room_availabilities에 채워 넣을 기간(오늘부터 며칠간). 시드를 다시 실행하면 이 기간 중 빠진 날짜만 채운다.
const AVAILABILITY_DAYS = Number(process.env.SEED_AVAILABILITY_DAYS) || 365;

// booking-service.service.ts의 FACILITY_NAME_INDOOR_POOL/FACILITY_NAME_LOUNGE 상수와
// name이 정확히 일치해야 createBooking의 편의시설 요금 조회(이름 매칭)가 성공합니다.
const FACILITY_SEEDS: Pick<Facility, 'name' | 'price'>[] = [
  { name: '수영장', price: 30000 },
  { name: '라운지', price: 50000 },
];

// 첫 공지 (LDP-147) — 프론트가 직접 적어 두던 frontend/src/data/notices.ts의 6건 그대로.
// date는 작성일(created_at)로 넣는다 (한국 날짜가 같게 보이도록 UTC 자정).
const NOTICE_SEEDS: {
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

const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const SEED_ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? '관리자';

interface HotelSeed {
  hotel: Pick<Hotel, 'name' | 'address' | 'phoneNumber' | 'description'>;
  // images: scripts/seed-images/ 안의 사진 파일 이름 (배열 순서 = 노출 순서, 첫 번째가 대표 사진) — seedRoomImages()
  rooms: (Pick<RoomType, 'name' | 'capacity' | 'totalCount' | 'description'> & {
    images: string[];
  })[];
}

// 객실 설명에 소개 문구 + 침실/침대 구성 + 최대 인원 + 제공 어메니티를 한 항목씩 줄바꿈해서 정리한다.
// 프론트의 room-detail-description/room-detail-modal-description 둘 다 white-space: pre-line이라
// 이 \n 줄바꿈이 그대로 화면에 반영된다(RoomDetailPage.css, RoomDetailModal.css).
function describeRoom(opts: {
  intro: string;
  bedroomCount: number;
  bedConfig: string;
  maxGuests: number;
  amenities: string[];
}): string {
  return [
    opts.intro,
    '',
    `- 침실: ${opts.bedroomCount}개 (${opts.bedConfig})`,
    `- 최대 인원: ${opts.maxGuests}명`,
    `- 제공 어메니티: ${opts.amenities.join(', ')}`,
  ].join('\n');
}

// 호텔당 객실 타입 4개, 타입별 보유 수량(totalCount)을 합쳐 호텔당 방 20개 · 전체 60개 (LDP-62).
// rooms 한 줄 = 객실 타입이라, 같은 날짜에 보유 수량만큼 예약을 받는다 — 성능 테스트나 여러 명이 동시에
// 테스트해도 금방 매진되지 않게 하려는 것 (60개 × 365일 = 21,900박).
//
// hotelId가 1/2/3 순서로 생성되도록(빈 테이블 기준 auto_increment) 배열 순서를 유지합니다.
// frontend/src/data/hotels.ts의 하드코딩 배열(서울점=1, 부산점=2, 제주점=3)과 맞물립니다.
const HOTEL_SEEDS: HotelSeed[] = [
  {
    hotel: {
      name: '서울점',
      address: '서울 강남구 테헤란로 123',
      phoneNumber: '02-1234-5678',
      description: '도심 속에서 누리는 조용한 휴식',
    },
    rooms: [
      {
        name: '디럭스 더블룸',
        images: [
          '01-seoul-deluxe-double-1.jpg',
          '01-seoul-deluxe-double-2.jpg',
        ],
        capacity: 2,
        totalCount: 10,
        description: describeRoom({
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
        }),
      },
      {
        name: '스탠다드 트윈룸',
        images: [
          '02-seoul-standard-twin-1.jpg',
          '02-seoul-standard-twin-2.jpg',
        ],
        capacity: 2,
        totalCount: 5,
        description: describeRoom({
          intro: '실용적인 구성의 스탠다드 트윈룸입니다.',
          bedroomCount: 1,
          bedConfig: '싱글사이즈 베드 2개',
          maxGuests: 2,
          amenities: ['무료 Wi-Fi', '32인치 TV', '냉장고', '전기 주전자', '헤어드라이어', '욕실 어메니티'],
        }),
      },
      {
        name: '프리미어 스위트룸',
        images: [
          '03-seoul-premier-suite-1.jpg',
          '03-seoul-premier-suite-2.jpg',
        ],
        capacity: 3,
        totalCount: 2,
        description: describeRoom({
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
        }),
      },
      {
        name: '패밀리룸',
        images: ['04-seoul-family-1.jpg', '04-seoul-family-2.jpg'],
        capacity: 4,
        totalCount: 3,
        description: describeRoom({
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
        }),
      },
    ],
  },
  {
    hotel: {
      name: '부산점',
      address: '부산 해운대구 해운대해변로 264',
      phoneNumber: '051-1234-5678',
      description: '오션뷰와 함께하는 여유로운 시간',
    },
    rooms: [
      {
        name: '오션뷰 스위트룸',
        images: [
          '05-busan-oceanview-suite-1.jpg',
          '05-busan-oceanview-suite-2.jpg',
        ],
        capacity: 2,
        totalCount: 5,
        description: describeRoom({
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
        }),
      },
      {
        name: '스탠다드 더블룸',
        images: [
          '06-busan-standard-double-1.jpg',
          '06-busan-standard-double-2.jpg',
        ],
        capacity: 2,
        totalCount: 5,
        description: describeRoom({
          intro: '아늑한 구성의 스탠다드 더블룸입니다.',
          bedroomCount: 1,
          bedConfig: '더블사이즈 베드 1개',
          maxGuests: 2,
          amenities: ['무료 Wi-Fi', 'TV', '냉장고', '헤어드라이어', '욕실 어메니티'],
        }),
      },
      {
        name: '프리미엄 오션뷰룸',
        images: [
          '07-busan-premium-oceanview-1.jpg',
          '07-busan-premium-oceanview-2.jpg',
        ],
        capacity: 3,
        totalCount: 5,
        description: describeRoom({
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
        }),
      },
      {
        name: '패밀리 트윈룸',
        images: ['08-busan-family-twin-1.jpg', '08-busan-family-twin-2.jpg'],
        capacity: 4,
        totalCount: 5,
        description: describeRoom({
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
        }),
      },
    ],
  },
  {
    hotel: {
      name: '제주점',
      address: '제주 서귀포시 중문관광로72번길 100',
      phoneNumber: '064-1234-5678',
      description: '자연 속 프라이빗한 힐링 스테이',
    },
    rooms: [
      {
        name: '가든뷰 트윈룸',
        images: [
          '09-jeju-gardenview-twin-1.jpg',
          '09-jeju-gardenview-twin-2.jpg',
        ],
        capacity: 2,
        totalCount: 5,
        description: describeRoom({
          intro: '아늑한 정원 전망의 트윈룸입니다.',
          bedroomCount: 1,
          bedConfig: '싱글사이즈 베드 2개',
          maxGuests: 2,
          amenities: ['정원뷰 창', '무료 Wi-Fi', 'TV', '냉장고', '헤어드라이어', '욕실 어메니티'],
        }),
      },
      {
        name: '스탠다드 더블룸',
        images: [
          '10-jeju-standard-double-1.jpg',
          '10-jeju-standard-double-2.jpg',
        ],
        capacity: 2,
        totalCount: 10,
        description: describeRoom({
          intro: '제주의 자연을 가까이 느낄 수 있는 스탠다드룸입니다.',
          bedroomCount: 1,
          bedConfig: '더블사이즈 베드 1개',
          maxGuests: 2,
          amenities: ['무료 Wi-Fi', 'TV', '냉장고', '전기 주전자', '욕실 어메니티'],
        }),
      },
      {
        name: '프라이빗 풀빌라룸',
        images: [
          '11-jeju-private-poolvilla-1.jpg',
          '11-jeju-private-poolvilla-2.jpg',
        ],
        capacity: 3,
        totalCount: 3,
        description: describeRoom({
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
        }),
      },
      {
        name: '패밀리 스위트룸',
        images: ['12-jeju-family-suite-1.jpg', '12-jeju-family-suite-2.jpg'],
        capacity: 4,
        totalCount: 2,
        description: describeRoom({
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
        }),
      },
    ],
  },
];

// mariadb 컨테이너가 healthy해도, 접속 직후 잠깐 연결이 튈 수 있어 짧게 재시도합니다.
// 테이블은 전부 main-db-migration(Flyway)이 만들어 두므로 synchronize: false로 엽니다 — true로 열면
// 이 스크립트가 돌 때마다 Flyway가 건 FK를 지워버립니다.
async function createDataSourceWithRetry(
  maxAttempts = 5,
  delayMs = 2000,
): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'mariadb',
    host: DB_HOST,
    port: DB_PORT,
    username: DB_USERNAME,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    // 운영 RDS는 TLS 접속만 허용 — DB_SSL=true + DB_SSL_CA_PATH로 켠다 (LDP-101, 비우면 평문)
    ssl: mariaDbSslOptions('DB'),
    entities: [
      Admin,
      AdminCredential,
      Hotel,
      RoomType,
      RoomUnit,
      RoomAvailability,
      RoomImage,
      Facility,
    ],
    synchronize: false,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await dataSource.initialize();
      return dataSource;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[seed] DB 연결 실패 (${attempt}/${maxAttempts}): ${message}`,
      );
      if (attempt === maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('unreachable');
}

async function seedAdmin(dataSource: DataSource): Promise<void> {
  if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
    console.warn(
      '[seed] SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD가 설정되지 않아 관리자 계정 시딩을 건너뜁니다.',
    );
    return;
  }

  const adminRepository = dataSource.getRepository(Admin);
  const credentialRepository = dataSource.getRepository(AdminCredential);

  const existing = await adminRepository.findOne({
    where: { email: SEED_ADMIN_EMAIL },
  });
  if (existing) {
    console.log(
      `[seed] 관리자 계정이 이미 존재합니다 (${SEED_ADMIN_EMAIL}) — 건너뜁니다.`,
    );
    return;
  }

  const admin = await adminRepository.save(
    adminRepository.create({ email: SEED_ADMIN_EMAIL, name: SEED_ADMIN_NAME }),
  );
  const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, SALT_ROUNDS);
  await credentialRepository.save(
    credentialRepository.create({ adminId: admin.id, passwordHash }),
  );

  console.log(`[seed] 관리자 계정 생성 완료: ${SEED_ADMIN_EMAIL}`);
}

async function seedHotelsAndRooms(dataSource: DataSource): Promise<void> {
  const hotelRepository = dataSource.getRepository(Hotel);
  const roomRepository = dataSource.getRepository(RoomType);

  const hotelCount = await hotelRepository.count();
  if (hotelCount > 0) {
    console.log(
      '[seed] 호텔 데이터가 이미 존재합니다 — 호텔/객실 시딩을 건너뜁니다.',
    );
    await syncSeedRoomTotalCounts(dataSource);
    return;
  }

  for (const seed of HOTEL_SEEDS) {
    const hotel = await hotelRepository.save(
      hotelRepository.create(seed.hotel),
    );
    await roomRepository.save(
      seed.rooms.map(({ name, capacity, totalCount, description }) =>
        roomRepository.create({
          hotelId: hotel.hotelId,
          name,
          capacity,
          totalCount,
          description,
        }),
      ),
    );
    console.log(
      `[seed] 호텔/객실 생성 완료: ${seed.hotel.name} (hotelId=${hotel.hotelId}, 객실 ${seed.rooms.length}개)`,
    );
  }
}

// V8 이전에 시드로 만든 객실은 보유 수량이 기본값 1로 들어가 있다. 시드 객실(호텔 이름 + 객실 이름이
// 같은 것) 중 아직 1인 것만 위 표의 보유 수량으로 맞춘다 — 관리자가 직접 바꾼 값(1이 아닌 값)은 건드리지 않는다.
async function syncSeedRoomTotalCounts(dataSource: DataSource): Promise<void> {
  const hotelRepository = dataSource.getRepository(Hotel);
  const roomRepository = dataSource.getRepository(RoomType);

  for (const seed of HOTEL_SEEDS) {
    const hotel = await hotelRepository.findOne({
      where: { name: seed.hotel.name },
    });
    if (!hotel) {
      continue;
    }
    for (const roomSeed of seed.rooms) {
      const { affected } = await roomRepository.update(
        { hotelId: hotel.hotelId, name: roomSeed.name, totalCount: 1 },
        { totalCount: roomSeed.totalCount },
      );
      if (affected) {
        console.log(
          `[seed] 보유 수량 설정: ${seed.hotel.name} ${roomSeed.name} → ${roomSeed.totalCount}개`,
        );
      }
    }
  }
}

// 실제 호실(rooms, V9 · LDP-86)을 객실 종류별 보유 수량만큼 만든다. 지점별 20개, 전체 60개.
// 방 번호: 지점 안에서 객실 종류마다 층을 하나씩(위 표 순서대로 2층부터), 번호 = 층 × 100 + 순번 (예: 201~210).
// 이미 있는 방 번호는 건너뛰어서 여러 번 실행해도 안전하다.
// 다 만든 뒤 보유 수량(total_count)을 ACTIVE 호실 수로 맞춘다 — 보유 수량 = 사용 가능한 호실 수 (LDP-82).
// 시드 객실 종류(호텔 이름 + 객실 종류 이름이 같은 것)만 다루고, 관리자가 만든 객실 종류는 건드리지 않는다.
const FIRST_SEED_FLOOR = 2;

async function seedRoomUnits(dataSource: DataSource): Promise<void> {
  const hotelRepository = dataSource.getRepository(Hotel);
  const roomTypeRepository = dataSource.getRepository(RoomType);
  const roomUnitRepository = dataSource.getRepository(RoomUnit);

  for (const seed of HOTEL_SEEDS) {
    const hotel = await hotelRepository.findOne({
      where: { name: seed.hotel.name },
    });
    if (!hotel) {
      continue;
    }

    for (const [index, roomSeed] of seed.rooms.entries()) {
      const roomType = await roomTypeRepository.findOne({
        where: { hotelId: hotel.hotelId, name: roomSeed.name },
      });
      if (!roomType) {
        continue;
      }

      const floor = FIRST_SEED_FLOOR + index;
      const roomNumbers = Array.from(
        { length: roomSeed.totalCount },
        (_, i) => String(floor * 100 + i + 1),
      );
      const existing = await roomUnitRepository.find({
        select: { roomNumber: true },
        where: { hotelId: hotel.hotelId, roomNumber: In(roomNumbers) },
      });
      const existingNumbers = new Set(existing.map((unit) => unit.roomNumber));
      const missing = roomNumbers.filter(
        (number) => !existingNumbers.has(number),
      );
      if (missing.length > 0) {
        await roomUnitRepository.insert(
          missing.map((roomNumber) => ({
            roomId: roomType.roomId,
            hotelId: hotel.hotelId,
            roomNumber,
            floor,
            status: RoomUnitStatus.ACTIVE,
          })),
        );
        console.log(
          `[seed] 호실 ${missing.length}개 생성: ${seed.hotel.name} ${roomSeed.name} (${missing[0]}~${missing[missing.length - 1]})`,
        );
      }

      const activeCount = await roomUnitRepository.count({
        where: { roomId: roomType.roomId, status: RoomUnitStatus.ACTIVE },
      });
      if (activeCount > 0 && roomType.totalCount !== activeCount) {
        await roomTypeRepository.update(
          { roomId: roomType.roomId },
          { totalCount: activeCount },
        );
        console.log(
          `[seed] 보유 수량을 ACTIVE 호실 수로 맞춤: ${seed.hotel.name} ${roomSeed.name} ${roomType.totalCount} → ${activeCount}`,
        );
      }
    }
  }
}

// 로컬 타임존 기준 YYYY-MM-DD 문자열로 변환 (date 컬럼용).
// toISOString()은 UTC로 변환하면서 날짜가 하루 밀릴 수 있어 사용하지 않습니다.
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function seedRoomAvailabilities(dataSource: DataSource): Promise<void> {
  const roomRepository = dataSource.getRepository(RoomType);
  const availabilityRepository = dataSource.getRepository(RoomAvailability);

  const rooms = await roomRepository.find();
  if (rooms.length === 0) {
    console.log(
      '[seed] 객실(rooms) 데이터가 없어 예약 가능 정보 시딩을 건너뜁니다.',
    );
    return;
  }

  const today = new Date();
  const dates = Array.from({ length: AVAILABILITY_DAYS }, (_, offset) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return formatDate(date);
  });

  // 날짜 단위로 빠진 날짜만 채운다 — 이미 있는 날짜는 그대로 두므로 그 날의 예약 수(booked_count)·
  // 판매 중지·가격이 유지되고, 시드를 다시 실행하면 오늘 기준으로 기간이 연장된다.
  for (const room of rooms) {
    const existing = await availabilityRepository.find({
      select: { date: true },
      where: {
        roomId: room.roomId,
        date: Between(dates[0], dates[dates.length - 1]),
      },
    });
    const existingDates = new Set(existing.map((row) => row.date));
    const missing = dates.filter((date) => !existingDates.has(date));
    if (missing.length === 0) {
      console.log(
        `[seed] roomId=${room.roomId}의 예약 가능 정보가 이미 모두 있습니다 — 건너뜁니다.`,
      );
      continue;
    }

    await availabilityRepository.insert(
      missing.map((date) => ({
        roomId: room.roomId,
        date,
        price: DEFAULT_ROOM_PRICE,
        isAvailable: true,
        bookedCount: 0,
      })),
    );
    console.log(
      `[seed] roomId=${room.roomId} 예약 가능 정보 ${missing.length}건 추가 (${dates[0]} ~ ${dates[dates.length - 1]} 중 빠진 날짜)`,
    );
  }
}

async function seedFacilities(dataSource: DataSource): Promise<void> {
  const hotelRepository = dataSource.getRepository(Hotel);
  const facilityRepository = dataSource.getRepository(Facility);

  const hotels = await hotelRepository.find();
  if (hotels.length === 0) {
    console.log(
      '[seed] 호텔(hotels) 데이터가 없어 편의시설 시딩을 건너뜁니다.',
    );
    return;
  }

  for (const hotel of hotels) {
    const existingCount = await facilityRepository.count({
      where: { hotelId: hotel.hotelId },
    });
    if (existingCount > 0) {
      console.log(
        `[seed] hotelId=${hotel.hotelId}의 편의시설이 이미 존재합니다 — 건너뜁니다.`,
      );
      continue;
    }

    const facilities = FACILITY_SEEDS.map((seed) =>
      facilityRepository.create({ hotelId: hotel.hotelId, ...seed }),
    );
    await facilityRepository.save(facilities);
    console.log(
      `[seed] hotelId=${hotel.hotelId} 편의시설 생성 완료: ${FACILITY_SEEDS.map((f) => `${f.name}(${f.price}원)`).join(', ')}`,
    );
  }
}

// 공지 시딩 (LDP-147): notices 테이블이 비어 있을 때만 첫 공지 6건을 넣는다 —
// 관리자가 공지를 올리거나 고친 뒤 시드를 다시 실행해도 덮어쓰거나 늘어나지 않는다.
async function seedNotices(dataSource: DataSource): Promise<void> {
  const [{ count }]: { count: number | string }[] = await dataSource.query(
    'SELECT COUNT(*) AS count FROM notices',
  );
  if (Number(count) > 0) {
    console.log('[seed] 공지(notices)가 이미 있습니다 — 건너뜁니다.');
    return;
  }
  for (const notice of NOTICE_SEEDS) {
    const createdAt = `${notice.date} 00:00:00`;
    await dataSource.query(
      `INSERT INTO notices (title, body, category, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        notice.title,
        notice.body,
        notice.category,
        notice.pinned ? 1 : 0,
        createdAt,
        createdAt,
      ],
    );
  }
  console.log(`[seed] 공지 ${NOTICE_SEEDS.length}건 생성 완료`);
}

// 객실 사진 시딩 (LDP-126): 사진이 하나도 없는 시드 객실 종류에만 scripts/seed-images/의 사진을 저장소
// (로컬·dev MinIO / 운영 S3)에 올리고 room_images에 경로(object_key)를 저장한다. 경로 규칙은
// hotel-service RoomImageStorage와 같다(room-types/{객실 종류 ID}/{uuid}.jpg) — 화면은 Presigned URL로 보여준다.
// - 이미 사진이 있는 객실 종류(관리자가 올렸거나 이전 시딩)는 건너뛴다 → 여러 번 실행해도 늘어나지 않음
// - 한 객실의 사진 파일이 하나라도 없으면 그 객실은 건너뛴다(일부만 올라가면 나머지를 다시 채울 수 없어서)
// - 저장소 설정(S3_BUCKET)이 없는 환경에서는 사진 단계만 건너뛴다
const SEED_IMAGES_DIR = join(__dirname, 'seed-images');

function createSeedS3Client(): S3Client {
  const credentials =
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined; // 키가 없으면(운영) SDK 기본 자격 증명 체인 → IAM 역할
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'ap-northeast-2',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials,
  });
}

async function seedRoomImages(dataSource: DataSource): Promise<void> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.log(
      '[seed] S3_BUCKET이 설정되지 않아 객실 사진 시딩을 건너뜁니다.',
    );
    return;
  }

  const hotelRepository = dataSource.getRepository(Hotel);
  const roomRepository = dataSource.getRepository(RoomType);
  const imageRepository = dataSource.getRepository(RoomImage);
  const s3 = createSeedS3Client();
  let seededRooms = 0;

  for (const seed of HOTEL_SEEDS) {
    const hotel = await hotelRepository.findOne({
      where: { name: seed.hotel.name },
    });
    if (!hotel) continue;

    for (const roomSeed of seed.rooms) {
      const room = await roomRepository.findOne({
        where: { hotelId: hotel.hotelId, name: roomSeed.name },
      });
      if (!room) continue;
      if (
        (await imageRepository.count({ where: { roomId: room.roomId } })) > 0
      ) {
        continue;
      }

      const files = roomSeed.images.map((file) => join(SEED_IMAGES_DIR, file));
      const missing = roomSeed.images.filter((_, i) => !existsSync(files[i]));
      if (missing.length > 0) {
        console.warn(
          `[seed] ${seed.hotel.name} ${roomSeed.name}: 사진 파일이 없어 건너뜁니다 (${missing.join(', ')})`,
        );
        continue;
      }

      const objectKeys: string[] = [];
      for (const file of files) {
        const objectKey = `room-types/${room.roomId}/${randomUUID()}.jpg`;
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: readFileSync(file),
            ContentType: 'image/jpeg',
          }),
        );
        objectKeys.push(objectKey);
      }
      await imageRepository.save(
        objectKeys.map((objectKey, sortOrder) =>
          imageRepository.create({
            roomId: room.roomId,
            mimeType: 'image/jpeg',
            objectKey,
            sortOrder,
          }),
        ),
      );
      seededRooms += 1;
    }
  }
  console.log(`[seed] 객실 사진 시딩 완료: 객실 종류 ${seededRooms}개`);
}

async function main(): Promise<void> {
  const dataSource = await createDataSourceWithRetry();
  try {
    await seedAdmin(dataSource);
    await seedHotelsAndRooms(dataSource);
    await seedRoomUnits(dataSource);
    await seedFacilities(dataSource);
    await seedRoomAvailabilities(dataSource);
    await seedRoomImages(dataSource);
    await seedNotices(dataSource);
    console.log('[seed] 시딩 완료');
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] 시딩 실패:', err);
    process.exit(1);
  });
