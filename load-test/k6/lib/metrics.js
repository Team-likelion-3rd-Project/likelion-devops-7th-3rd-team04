// 사용자 정의 지표 (위키 「흐름 C 처리 규칙」)
import { Rate, Trend, Counter } from 'k6/metrics';

// 예약 시도 중 재고 부족 비율 (가용성 조회에서 매진 + 예약 생성 매진 응답, lib/booking-result.js). 높으면 서버가 아니라 데이터 부족 → 실행 무효
export const bookingSoldOut = new Rate('booking_sold_out');
// 예약 생성 중 매진이 아닌 실패 비율 (매진 아닌 404 · 5xx 등). 404 · 409 를 예상 응답으로 빼므로 에러는 여기서 판정한다
export const bookingCreateError = new Rate('booking_create_error');
// 결제 확정 응답 result 가 APPROVED 가 아닌 비율 (2xx 라도 실패일 수 있음)
export const paymentNotApproved = new Rate('payment_not_approved');
// 결제 확정 응답 → RESERVED 조회까지 걸린 시간 (SQS 비동기, 표본만)
export const bookingConfirmLag = new Trend('booking_confirm_lag', true);
// 표본 재조회 한도 안에 RESERVED 가 안 된 건수
export const bookingConfirmTimeout = new Counter('booking_confirm_timeout');
