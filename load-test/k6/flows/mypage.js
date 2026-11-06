// D. 내 예약 확인 (토큰 재사용) — 내 예약 → 내 결제 (2 요청). 화면처럼 첫 페이지(20건)만 받는다 (11-06 이후)
import { check } from 'k6';
import exec from 'k6/execution';
import { get } from '../lib/http.js';
import { think, userFor } from '../lib/data.js';

export function mypage(data) {
  const { token } = userFor(data, exec.vu.idInTest);

  const bookings = get('/api/bookings/me?page=1&size=20', 'GET /bookings/me?page', 'read', token);
  check(bookings, { 'D 내 예약 200': (r) => r.status === 200 });
  think();

  const payments = get('/api/payments/me?page=1&size=20', 'GET /payments/me?page', 'read', token);
  check(payments, { 'D 내 결제 200': (r) => r.status === 200 });
}
