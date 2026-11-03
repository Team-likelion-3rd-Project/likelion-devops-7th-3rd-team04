// setup() — 측정 전에 한 번: 호텔 · 객실 목록 수집, 테스트 사용자 토큰 일괄 발급
// 측정 중 로그인(bcrypt)이 섞이면 결과가 흔들리므로 토큰은 여기서 받고 테스트 내내 재사용한다.
import http from 'k6/http';
import encoding from 'k6/encoding';
import { fail } from 'k6';
import {
  BASE_URL,
  LT_USERS,
  LT_PASSWORD,
  LOGIN_BATCH,
  LOAD_HOTEL_PREFIX,
  CONCURRENCY_ROOM_NAME,
} from './config.js';
import { get, json } from './http.js';

function mustJson(res, what) {
  const body = json(res);
  if (res.status !== 200 || !body) fail(`${what} 실패: HTTP ${res.status} ${String(res.body).slice(0, 200)}`);
  return body;
}

// 호텔 · 객실 목록. 조회 흐름은 전체 호텔, 예약 흐름은 부하용 호텔만 쓴다
export function collectCatalog() {
  const { hotels } = mustJson(get('/api/hotels', 'GET /hotels', 'setup'), '호텔 목록');
  const all = [];
  const bookable = [];
  let concurrencyRoom = null;
  for (const hotel of hotels) {
    const { rooms } = mustJson(get(`/api/hotels/${hotel.hotelId}/rooms`, 'GET /hotels/:id/rooms', 'setup'), `객실 목록(${hotel.hotelId})`);
    const isLoadHotel = hotel.name.startsWith(LOAD_HOTEL_PREFIX);
    for (const room of rooms) {
      const r = { hotelId: hotel.hotelId, roomId: room.roomId, capacity: room.capacity };
      if (room.name === CONCURRENCY_ROOM_NAME) {
        if (isLoadHotel) concurrencyRoom = r;
        continue; // 동시 예약 전용 객실은 일반 흐름에서 쓰지 않는다
      }
      all.push(r);
      if (isLoadHotel) bookable.push(r);
    }
  }
  if (bookable.length === 0) fail(`「${LOAD_HOTEL_PREFIX}」 호텔이 없습니다 — loadtest-seed 를 먼저 실행하세요`);
  return { hotelIds: hotels.map((h) => h.hotelId), rooms: all, bookableRooms: bookable, concurrencyRoom };
}

function tokenExp(token) {
  const payload = JSON.parse(encoding.b64decode(token.split('.')[1], 'rawurl', 's'));
  return payload.exp;
}

// 테스트 사용자 count 명 로그인 (LOGIN_BATCH 개씩 동시에)
export function loginUsers(count) {
  if (!LT_PASSWORD) fail('LT_PASSWORD 가 없습니다 (loadtest-seed 에 넣은 해시의 원래 비밀번호)');
  const n = Math.min(count, LT_USERS);
  const users = [];
  for (let start = 1; start <= n; start += LOGIN_BATCH) {
    const batch = [];
    for (let i = start; i < start + LOGIN_BATCH && i <= n; i++) {
      const email = `loadtest-${String(i).padStart(4, '0')}@loadtest.example.com`;
      batch.push({
        method: 'POST',
        url: `${BASE_URL}/api/auth/login`,
        body: JSON.stringify({ email, password: LT_PASSWORD }),
        params: { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login', kind: 'setup' } },
      });
    }
    for (const res of http.batch(batch)) {
      const body = json(res);
      if (!body || !body.accessToken) fail(`테스트 사용자 로그인 실패: HTTP ${res.status} ${String(res.body).slice(0, 200)}`);
      users.push({ userId: body.userId, token: body.accessToken });
    }
  }
  return users;
}

// 토큰 만료 전에 테스트가 끝나는지 확인 — 운영 기본 15분, 테스트 브랜치에서 2시간 (위키 선행 조건 9)
export function assertTokenLifetime(users, testSeconds) {
  const exp = Math.min(...users.map((u) => tokenExp(u.token)));
  const remaining = exp - Math.floor(Date.now() / 1000);
  if (remaining < testSeconds + 60) {
    fail(`토큰 남은 수명 ${remaining}초 < 테스트 ${testSeconds}초 + 60초 — 테스트 브랜치 JWT_ACCESS_EXPIRES_IN 확인`);
  }
  return exp;
}
