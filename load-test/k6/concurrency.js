// 4. 동시 예약 테스트 (LDP-196, 위키 「테스트 유형」) — 오버부킹 없음 확인
//   k6 run -e BASE_URL=... -e LT_PASSWORD=... load-test/k6/concurrency.js
//
// 재고 1개인 「동시예약 전용룸」의 같은 날짜(1박)에 서로 다른 사용자 CONC_USERS 명이 같은 순간 예약한다.
// hotel-service 가 객실 종류 × 날짜 행을 비관적 락으로 잡으므로 성공은 정확히 남은 방 수(1)여야 한다.
// 성공한 예약은 결제하지 않아 결제 마감까지 재고를 잡는다 → 다음 실행은 자동으로 다음 날짜를 고른다.
import { check, sleep, fail } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { get, post, json, query } from './lib/http.js';
import { collectCatalog, loginUsers, assertTokenLifetime } from './lib/setup.js';
import { summarize } from './lib/summary.js';
import { CREATE_EXPECTED, classifyCreate } from './lib/booking-result.js';

const USERS = Number(__ENV.CONC_USERS || 100);
const SEARCH_DAYS = 60; // 남은 방이 있는 날짜를 찾을 범위 (내일부터)

const success = new Counter('concurrency_success');
const soldOut = new Counter('concurrency_sold_out');
const unexpected = new Counter('concurrency_unexpected');

export const options = {
  scenarios: {
    concurrency: { executor: 'per-vu-iterations', exec: 'reserve', vus: USERS, iterations: 1, maxDuration: '2m' },
  },
  thresholds: {
    concurrency_success: ['count==1'], // 남은 방 1개 → 성공 1건
    concurrency_unexpected: ['count==0'], // 생성 · 매진 외 응답 (매진 아닌 404, 5xx, 타임아웃 등)
    checks: ['rate==1'], // teardown 의 사후 확인 포함
    'http_req_duration{name:POST /bookings}': ['max>=0'], // 락 대기가 응답 시간에 드러난다
  },
  setupTimeout: '5m',
  summaryTrendStats: ['count', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  tags: { test: 'concurrency' },
};

function kstDate(offsetDays) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}

function availability(room, date) {
  const res = get(
    `/api/hotels/${room.hotelId}/rooms/${room.roomId}/availability?${query({ startDate: date, endDate: date })}`,
    'GET /hotels/:id/rooms/:id/availability',
    'setup',
  );
  const body = json(res);
  return body && body.availabilities && body.availabilities[0] ? body.availabilities[0] : null;
}

export function setup() {
  const { concurrencyRoom: room } = collectCatalog();
  if (!room) fail('「동시예약 전용룸」이 없습니다 — loadtest-seed 를 먼저 실행하세요');

  // 남은 방이 정확히 1개인 가장 가까운 날짜 (이전 실행이 잡은 날짜는 건너뛴다)
  const from = kstDate(1);
  const to = kstDate(SEARCH_DAYS);
  const res = get(
    `/api/hotels/${room.hotelId}/rooms/${room.roomId}/availability?${query({ startDate: from, endDate: to })}`,
    'GET /hotels/:id/rooms/:id/availability',
    'setup',
  );
  const days = (json(res) || {}).availabilities || [];
  const day = days.find((d) => d.isAvailable && d.remainingCount === 1);
  if (!day) fail(`${from} ~ ${to} 에 남은 방이 1개인 날짜가 없습니다`);

  const users = loginUsers(USERS);
  if (users.length < USERS) fail(`테스트 사용자가 ${users.length}명뿐입니다 (CONC_USERS=${USERS}, LT_USERS 확인)`);
  assertTokenLifetime(users, 120);

  const next = new Date(`${day.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  // 모든 VU 가 같은 순간 출발하도록 기준 시각을 정한다 (VU 초기화 시간 여유 5초)
  return { room, date: day.date, checkOut: next.toISOString().slice(0, 10), users, startAt: Date.now() + 5000, startedAt: new Date().toISOString() };
}

export function reserve(data) {
  const wait = data.startAt - Date.now();
  if (wait > 0) sleep(wait / 1000);

  const { token } = data.users[exec.vu.idInTest - 1]; // VU 마다 다른 사용자
  const res = post(
    '/api/bookings',
    { roomId: data.room.roomId, hotelId: data.room.hotelId, checkInDate: data.date, checkOutDate: data.checkOut, guestCount: 1 },
    'POST /bookings',
    'write',
    token,
    CREATE_EXPECTED,
  );
  // 매진이 아닌 404(서비스 장애 등)는 unexpected — lib/booking-result.js
  const outcome = classifyCreate(res);
  if (outcome === 'created') success.add(1);
  else if (outcome === 'sold_out') soldOut.add(1);
  else unexpected.add(1);
}

// 사후 확인 — 그 날짜의 남은 방이 0 (예약 수가 재고를 넘지 않음). DB 예약 건수는 README 의 SQL 로 교차 확인
export function teardown(data) {
  const day = availability(data.room, data.date);
  check(day, { '사후: 남은 방 0': (d) => d !== null && d.remainingCount === 0 });
  console.log(`동시 예약 대상: roomId=${data.room.roomId} date=${data.date}`);
}

export function handleSummary(data) {
  return summarize(data, 'concurrency');
}
