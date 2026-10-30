// API 단독 측정 (테스트 1 API 기준선, tune -e API=) — 위키 「API 단독 측정 대상」
// 흐름 1회 = 측정 대상 요청 1건 (생각 시간 없음). 준비 요청은 kind: prep 으로 SLO · 에러 판정에서 뺀다.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { get, post, json, query } from '../lib/http.js';
import { pick, pickStay, userFor } from '../lib/data.js';
import { bookingSoldOut, bookingCreateError, paymentNotApproved } from '../lib/metrics.js';
import { CREATE_EXPECTED, classifyCreate } from '../lib/booking-result.js';
import { BASE_URL, LT_PASSWORD } from '../lib/config.js';

// GET /api/hotels — 읽기, 트래픽 최다
export function apiHotels() {
  const res = get('/api/hotels', 'GET /hotels', 'read');
  check(res, { '호텔 목록 200': (r) => r.status === 200 });
}

// GET availability — 읽기, 날짜 범위
export function apiAvailability(data) {
  const room = pick(data.rooms);
  const { checkIn, lastNight } = pickStay();
  const res = get(
    `/api/hotels/${room.hotelId}/rooms/${room.roomId}/availability?${query({ startDate: checkIn, endDate: lastNight })}`,
    'GET /hotels/:id/rooms/:id/availability',
    'read',
  );
  check(res, { '가용성 200': (r) => r.status === 200 });
}

// POST /api/bookings — 쓰기, 비관적 락, 서비스 간 gRPC. 결제하지 않은 예약이 결제 마감까지 재고를 잡는다
function createBooking(data, kind) {
  const { token } = userFor(data, exec.vu.idInTest);
  const room = pick(data.bookableRooms);
  const { checkIn, checkOut } = pickStay();
  const res = post(
    '/api/bookings',
    { roomId: room.roomId, hotelId: room.hotelId, checkInDate: checkIn, checkOutDate: checkOut, guestCount: Math.min(2, room.capacity) },
    'POST /bookings',
    kind,
    token,
    CREATE_EXPECTED,
  );
  const outcome = classifyCreate(res);
  bookingSoldOut.add(outcome === 'sold_out');
  bookingCreateError.add(outcome === 'error');
  return { token, res, outcome, body: outcome === 'created' ? json(res) : null };
}

export function apiBooking(data) {
  const { outcome } = createBooking(data, 'write');
  check(outcome, { '예약 생성 (생성 또는 매진)': (o) => o !== 'error' });
}

// POST /api/auth/login — CPU 집약 (bcrypt). 테스트 사용자를 돌아가며 쓴다
export function apiLogin(data) {
  const i = (exec.scenario.iterationInTest % data.users.length) + 1;
  const email = `loadtest-${String(i).padStart(4, '0')}@loadtest.example.com`;
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email, password: LT_PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /auth/login', kind: 'write' },
  });
  check(res, { '로그인 201': (r) => r.status === 201 });
}

// POST confirm — PrivateLink → 결제 서버 → pg-mock. 예약 생성 · 결제 준비는 준비 요청(prep)
export function apiConfirm(data) {
  const { token, body } = createBooking(data, 'prep');
  if (!body || !body.reservationId) return;
  const prepared = post(`/api/bookings/${body.reservationId}/payment-attempts`, {}, 'POST /bookings/:id/payment-attempts', 'prep', token);
  const attempt = json(prepared);
  if (!attempt || !attempt.orderId) return;
  const res = post(
    `/api/bookings/${body.reservationId}/payment-attempts/confirm`,
    { paymentKey: `mock_${attempt.orderId}`, orderId: attempt.orderId, amount: attempt.amount },
    'POST /bookings/:id/payment-attempts/confirm',
    'write',
    token,
  );
  const result = json(res);
  const approved = res.status === 200 && result !== null && result.result === 'APPROVED';
  check(res, { '결제 확정 APPROVED': () => approved });
  paymentNotApproved.add(!approved);
}

// -e API= 값 → 시나리오 exec 이름 · 이터레이션당 요청 수
export const APIS = {
  hotels: { exec: 'apiHotels', requests: 1 },
  availability: { exec: 'apiAvailability', requests: 1 },
  booking: { exec: 'apiBooking', requests: 1 },
  login: { exec: 'apiLogin', requests: 1 },
  confirm: { exec: 'apiConfirm', requests: 3 },
};
