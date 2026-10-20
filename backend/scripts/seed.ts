import 'reflect-metadata';
import { Between, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Admin } from '../apps/user-service/src/admin/entities/admin.entity';
import { AdminCredential } from '../apps/auth-service/src/entities/admin-credential.entity';
import { Hotel } from '../apps/hotel-service/src/entities/hotel.entity';
import { Room } from '../apps/hotel-service/src/entities/room.entity';
import { RoomAvailability } from '../apps/hotel-service/src/entities/room-availability.entity';
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

const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const SEED_ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? '관리자';

interface HotelSeed {
  hotel: Pick<Hotel, 'name' | 'address' | 'phoneNumber' | 'description'>;
  rooms: Pick<Room, 'name' | 'capacity' | 'totalCount' | 'description'>[];
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
    entities: [Admin, AdminCredential, Hotel, Room, RoomAvailability, Facility],
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
  const roomRepository = dataSource.getRepository(Room);

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
      seed.rooms.map((room) =>
        roomRepository.create({ hotelId: hotel.hotelId, ...room }),
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
  const roomRepository = dataSource.getRepository(Room);

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

// 로컬 타임존 기준 YYYY-MM-DD 문자열로 변환 (date 컬럼용).
// toISOString()은 UTC로 변환하면서 날짜가 하루 밀릴 수 있어 사용하지 않습니다.
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function seedRoomAvailabilities(dataSource: DataSource): Promise<void> {
  const roomRepository = dataSource.getRepository(Room);
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

async function main(): Promise<void> {
  const dataSource = await createDataSourceWithRetry();
  try {
    await seedAdmin(dataSource);
    await seedHotelsAndRooms(dataSource);
    await seedFacilities(dataSource);
    await seedRoomAvailabilities(dataSource);
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
