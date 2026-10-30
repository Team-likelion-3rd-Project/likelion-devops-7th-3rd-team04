// POST /api/bookings 응답 분류 — 매진과 에러를 가른다
//
// 지금 api-gateway 는 예약 생성 실패를 원인과 상관없이 전부 404 로 돌려준다 (매진 · 없는 객실 · hotel-service 장애).
// 그래서 404 는 message 가 매진 문구일 때만 매진으로 보고, 나머지 404 는 에러로 센다.
// 백엔드가 매진 409 · 장애 503 으로 고치면(백엔드에 전달함) 409 도 매진으로 받으므로 스크립트를 바꾸지 않아도 된다.
// 이후 404 매진 문구 분기는 지운다.
import http from 'k6/http';
import { json } from './http.js';

const SOLD_OUT_MESSAGE = '예약 불가능한 날짜가 포함되어 있습니다.';

// 404 · 409 는 http_req_failed 에서 빼고(매진이 write 에러율을 부풀리지 않게), 매진이 아닌 경우는 booking_create_error 로 센다
export const CREATE_EXPECTED = { responseCallback: http.expectedStatuses(201, 404, 409) };

// 'created' | 'sold_out' | 'error'
export function classifyCreate(res) {
  if (res.status === 201) return 'created';
  if (res.status === 409) return 'sold_out';
  if (res.status === 404) {
    const body = json(res);
    return body && body.message === SOLD_OUT_MESSAGE ? 'sold_out' : 'error';
  }
  return 'error';
}
