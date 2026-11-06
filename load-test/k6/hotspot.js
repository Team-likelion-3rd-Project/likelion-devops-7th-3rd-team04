// 재고 잠금 집중 테스트 (LDP-242, 부하 테스트 3차) — 같은 객실 종류 × 날짜 행에 예약이 몰릴 때의 처리 상한
//   k6 run -e BASE_URL=... -e LT_PASSWORD=... -e MODE=spread|hot|burst [-e STAGES=50,100,150] [-e STAGE_SECONDS=60] hotspot.js
//
// hotel-service reserveRoomAvailability 는 객실 종류 × 날짜 행을 배타 잠금으로 잡은 뒤 재고를 확인한다.
// 매진이어도 잠금을 먼저 잡으므로, 매진 상태에서 "같은 행"과 "흩어진 행"을 같은 부하로 비교하면
// 바뀌는 변수가 행 집중 하나뿐이다 (둘 다 거절 경로라 처리 내용이 같다).
//
//   spread : 「동시예약 전용룸」(1실, 매진) — 날짜를 SPREAD_DAYS 일에 흩어서 1박 예약
//   hot    : 「동시예약 전용룸」(1실, 매진) — 모든 요청이 같은 날짜(HOT_OFFSET 일 뒤) 1박
//   burst  : 「집중 성공룸」(999실, 가용) — 같은 날짜에 BURST_RPS 로 BURST_SECONDS 초. 성공은 정확히 보유 수량
//
// 준비: seed/hotspot-prep.sql (매진 날짜 · 999실 객실). 재고 초기화(reset) 뒤에는 다시 실행한다.
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { get, post, json, query } from './lib/http.js';
import { collectCatalog, loginUsers, assertTokenLifetime } from './lib/setup.js';
import { userFor } from './lib/data.js';
import { summarize } from './lib/summary.js';
import { CREATE_EXPECTED, classifyCreate } from './lib/booking-result.js';

const MODE = __ENV.MODE || 'hot';
// 단계 (예약/초) · 단계 길이(초). 공용 STAGES · STAGE_SECONDS(tune 용 기본값)와 따로 둔다 — 3차(11-06) 측정 기준
// 앱 요청 제한(THROTTLE_LIMIT)은 IP + 경로별이라 테스트 브랜치 30000/분이면 한 경로 500/초가 상한 (그 이상은 429)
const STAGES = (__ENV.STAGES || '50,100,150').split(',').map(Number);
const STAGE_SECONDS = Number(__ENV.STAGE_SECONDS || 60);
const SPREAD_DAYS = Number(__ENV.SPREAD_DAYS || 150); // 매진 준비 200일 안
const HOT_OFFSET = Number(__ENV.HOT_OFFSET || 30);
const BURST_OFFSET = Number(__ENV.BURST_OFFSET || 10);
const BURST_RPS = Number(__ENV.BURST_RPS || 200);
const BURST_SECONDS = Number(__ENV.BURST_SECONDS || 6);
const USERS = Number(__ENV.HOT_USERS || 200);
const BURST_ROOM_NAME = '집중 성공룸';

const created = new Counter('hotspot_created');
const soldOut = new Counter('hotspot_sold_out');
const unexpected = new Counter('hotspot_unexpected');

if (!['spread', 'hot', 'burst'].includes(MODE)) throw new Error(`MODE=${MODE} — spread | hot | burst`);

// 단계마다 5초 상승 + STAGE_SECONDS 유지
function rampingStages() {
  const out = [];
  for (const rps of STAGES) {
    out.push({ target: rps, duration: '5s' });
    out.push({ target: rps, duration: `${STAGE_SECONDS}s` });
  }
  return out;
}

const scenario =
  MODE === 'burst'
    ? { executor: 'constant-arrival-rate', rate: BURST_RPS, timeUnit: '1s', duration: `${BURST_SECONDS}s`, preAllocatedVUs: 200, maxVUs: 1000 }
    : { executor: 'ramping-arrival-rate', startRate: STAGES[0], timeUnit: '1s', stages: rampingStages(), preAllocatedVUs: 100, maxVUs: 1000 };

const ABORT = { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' };

export const options = {
  scenarios: { hotspot: Object.assign({ exec: 'reserve' }, scenario) },
  thresholds: Object.assign(
    {
      'http_req_failed{kind:write}': ['rate<0.01', ABORT], // 생성 · 매진(404) 외 응답
      hotspot_unexpected: ['count==0'],
      'http_req_duration{name:POST /bookings}': ['max>=0'], // 잠금 대기가 응답 시간에 드러난다
      checks: ['rate==1'],
    },
    MODE === 'burst' ? {} : { hotspot_created: ['count==0'] }, // 매진 경로 — 성공이 나오면 준비(hotspot-prep.sql)가 안 된 것
  ),
  setupTimeout: '5m',
  summaryTrendStats: ['count', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  tags: { test: `hotspot-${MODE}` },
};

function kstDate(offsetDays) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}

function availabilities(room, from, to) {
  const res = get(
    `/api/hotels/${room.hotelId}/rooms/${room.roomId}/availability?${query({ startDate: from, endDate: to })}`,
    'GET /hotels/:id/rooms/:id/availability',
    'setup',
  );
  return (json(res) || {}).availabilities || [];
}

function findBurstRoom(hotelId) {
  const { rooms } = json(get(`/api/hotels/${hotelId}/rooms`, 'GET /hotels/:id/rooms', 'setup')) || {};
  const room = (rooms || []).find((r) => r.name === BURST_ROOM_NAME);
  return room ? { hotelId, roomId: room.roomId, capacity: room.capacity } : null;
}

export function setup() {
  const { concurrencyRoom } = collectCatalog();
  if (!concurrencyRoom) fail('「동시예약 전용룸」이 없습니다 — loadtest-seed 를 먼저 실행하세요');

  let room = concurrencyRoom;
  let dates;
  if (MODE === 'burst') {
    room = findBurstRoom(concurrencyRoom.hotelId);
    if (!room) fail(`「${BURST_ROOM_NAME}」이 없습니다 — hotspot-prep.sql 을 먼저 실행하세요`);
    const date = kstDate(BURST_OFFSET);
    const [day] = availabilities(room, date, date);
    if (!day || !day.isAvailable || day.remainingCount < 1) fail(`${date} 에 남은 방이 없습니다 (${JSON.stringify(day)})`);
    dates = [date];
    console.log(`burst 대상 roomId=${room.roomId} date=${date} 남은 방 ${day.remainingCount}`);
  } else {
    const from = kstDate(1);
    const to = kstDate(SPREAD_DAYS);
    const days = availabilities(room, from, to);
    const open = days.filter((d) => d.remainingCount > 0);
    if (days.length < SPREAD_DAYS || open.length > 0) {
      fail(`${from} ~ ${to} 가 모두 매진이 아닙니다 (조회 ${days.length}일, 남은 방 있는 날 ${open.length}) — hotspot-prep.sql 확인`);
    }
    dates = MODE === 'hot' ? [kstDate(HOT_OFFSET)] : days.map((d) => d.date);
  }

  const users = loginUsers(USERS);
  const seconds = MODE === 'burst' ? BURST_SECONDS : STAGES.length * (STAGE_SECONDS + 5);
  assertTokenLifetime(users, seconds + 60);
  return { room, dates, users, startedAt: new Date().toISOString(), shape: MODE };
}

function nextDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function reserve(data) {
  const { token } = userFor(data, exec.vu.idInTest);
  const date = data.dates[exec.scenario.iterationInTest % data.dates.length];
  const res = post(
    '/api/bookings',
    { roomId: data.room.roomId, hotelId: data.room.hotelId, checkInDate: date, checkOutDate: nextDay(date), guestCount: 1 },
    'POST /bookings',
    'write',
    token,
    CREATE_EXPECTED,
  );
  const outcome = classifyCreate(res);
  if (outcome === 'created') created.add(1);
  else if (outcome === 'sold_out') soldOut.add(1);
  else unexpected.add(1);
  check(outcome, { '생성 또는 매진': (o) => o !== 'error' });
}

// burst 사후 확인 — 그 날짜의 남은 방 0 (성공이 보유 수량을 넘지 않음). DB 예약 건수는 따로 교차 확인
export function teardown(data) {
  if (MODE !== 'burst') return;
  const [day] = availabilities(data.room, data.dates[0], data.dates[0]);
  check(day, { '사후: 남은 방 0': (d) => d !== undefined && d.remainingCount === 0 });
  console.log(`burst 사후: ${JSON.stringify(day)}`);
}

export function handleSummary(data) {
  return summarize(data, `hotspot-${MODE}`);
}
