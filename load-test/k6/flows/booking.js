// C. 예약과 결제 (토큰 재사용) — 가용성 → 예약 생성 → 결제 준비 → 결제 확정(mock PG) → 내 예약 (5 요청)
//
// 서버 동작 (위키 「흐름 C 처리 규칙」)
//   - 예약 생성 실패는 지금 원인과 상관없이 404. 매진 문구일 때만 매진(booking_sold_out), 나머지는 에러(booking_create_error)
//     — 분류는 lib/booking-result.js (백엔드가 매진 409 로 바꾸면 그대로 매진으로 받음)
//   - 결제 확정은 2xx 라도 result 가 APPROVED 가 아닐 수 있다
//   - RESERVED 전환은 SQS 를 거쳐 비동기. 마지막 조회에서 상태를 판정하지 않고, 표본만 확정 지연을 잰다
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { get, post, json, query } from '../lib/http.js';
import { pick, pickStay, think, userFor } from '../lib/data.js';
import { bookingSoldOut, bookingCreateError, paymentNotApproved, bookingConfirmLag, bookingConfirmTimeout } from '../lib/metrics.js';
import { CREATE_EXPECTED, classifyCreate } from '../lib/booking-result.js';
import { CONFIRM_LAG_POLL_SECONDS, CONFIRM_LAG_MAX_POLLS } from '../lib/config.js';

export function booking(data) {
  const { token } = userFor(data, exec.vu.idInTest);
  const room = pick(data.bookableRooms);
  const { checkIn, checkOut, lastNight } = pickStay();

  const avail = get(
    `/api/hotels/${room.hotelId}/rooms/${room.roomId}/availability?${query({ startDate: checkIn, endDate: lastNight })}`,
    'GET /hotels/:id/rooms/:id/availability',
    'write',
    token,
  );
  const availBody = json(avail);
  check(avail, { 'C 가용성 200': (r) => r.status === 200 && availBody !== null });
  if (!availBody) return;
  if (!availBody.isAvailable) {
    bookingSoldOut.add(true); // 사용자는 여기서 다른 날짜를 고른다 — 흐름 종료
    return;
  }
  think();

  const created = post(
    '/api/bookings',
    { roomId: room.roomId, hotelId: room.hotelId, checkInDate: checkIn, checkOutDate: checkOut, guestCount: Math.min(2, room.capacity) },
    'POST /bookings',
    'write',
    token,
    CREATE_EXPECTED,
  );
  const outcome = classifyCreate(created);
  bookingSoldOut.add(outcome === 'sold_out'); // 가용성 조회와 예약 사이에 다른 요청이 마지막 방을 가져간 경우
  bookingCreateError.add(outcome === 'error');
  if (outcome === 'sold_out') return;
  const reservation = json(created);
  check(created, { 'C 예약 생성 201': (r) => r.status === 201 && reservation && reservation.reservationId > 0 });
  if (!reservation || !reservation.reservationId) return;
  const reservationId = reservation.reservationId;
  think();

  const prepared = post(`/api/bookings/${reservationId}/payment-attempts`, {}, 'POST /bookings/:id/payment-attempts', 'write', token);
  const attempt = json(prepared);
  check(prepared, { 'C 결제 준비 201': (r) => r.status === 201 && attempt && attempt.orderId });
  if (!attempt || !attempt.orderId) return;
  think();

  const confirmed = post(
    `/api/bookings/${reservationId}/payment-attempts/confirm`,
    { paymentKey: `mock_${attempt.orderId}`, orderId: attempt.orderId, amount: attempt.amount },
    'POST /bookings/:id/payment-attempts/confirm',
    'write',
    token,
  );
  const result = json(confirmed);
  const approved = confirmed.status === 200 && result !== null && result.result === 'APPROVED';
  check(confirmed, { 'C 결제 확정 APPROVED': () => approved });
  paymentNotApproved.add(!approved);
  const confirmedAt = Date.now();
  think();

  const mine = get('/api/bookings/me', 'GET /bookings/me', 'write', token);
  check(mine, { 'C 내 예약 200': (r) => r.status === 200 });

  if (approved && Math.random() < data.confirmLagSample) {
    measureConfirmLag(token, reservationId, confirmedAt, mine);
  }
}

// RESERVED 가 보일 때까지 /bookings/me 재조회 (kind: poll — SLO 제외). 해상도는 CONFIRM_LAG_POLL_SECONDS
function measureConfirmLag(token, reservationId, confirmedAt, firstRes) {
  let res = firstRes;
  for (let i = 0; i <= CONFIRM_LAG_MAX_POLLS; i++) {
    const body = json(res);
    const found = body && body.bookings ? body.bookings.find((b) => b.reservationId === reservationId) : null;
    if (found && found.status === 'RESERVED') {
      bookingConfirmLag.add(Date.now() - confirmedAt);
      return;
    }
    if (i === CONFIRM_LAG_MAX_POLLS) break;
    sleep(CONFIRM_LAG_POLL_SECONDS);
    res = get('/api/bookings/me', 'GET /bookings/me (poll)', 'poll', token);
  }
  bookingConfirmTimeout.add(1);
}
