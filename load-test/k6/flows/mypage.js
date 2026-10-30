// D. 내 예약 확인 (토큰 재사용) — 내 예약 → 내 결제 (2 요청)
import { check } from 'k6';
import exec from 'k6/execution';
import { get } from '../lib/http.js';
import { think, userFor } from '../lib/data.js';

export function mypage(data) {
  const { token } = userFor(data, exec.vu.idInTest);

  const bookings = get('/api/bookings/me', 'GET /bookings/me', 'read', token);
  check(bookings, { 'D 내 예약 200': (r) => r.status === 200 });
  think();

  const payments = get('/api/payments/me', 'GET /payments/me', 'read', token);
  check(payments, { 'D 내 결제 200': (r) => r.status === 200 });
}
