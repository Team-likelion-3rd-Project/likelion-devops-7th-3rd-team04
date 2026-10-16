-- 결제 시도에 "승인 요청 시각"을 추가 (LDP-67).
--
-- 시도 상태가 REQUESTED인 경우가 두 가지라 프론트가 구분하지 못했다.
--   A. 승인 요청(confirm)을 보냈지만 결과를 모름 (UNKNOWN/PROCESSING, payment-service 호출 실패) → 돈이 빠졌을 수도 있음
--   B. 결제 준비(payment-attempts)만 하고 승인 요청을 안 보냄 (토스 결제창에서 닫기 등) → 돈 안 빠짐
-- booking-service가 payment-service에 승인을 요청하기 직전에 이 시각을 기록한다. 값이 있으면 A, 없으면 B.
-- 예약 응답에서는 A를 lastPaymentAttemptStatus = CONFIRMING으로 내려 준다.
--
-- status ENUM은 그대로 둔다 — "WHERE status = 'REQUESTED'" 조건부 UPDATE들을 바꾸지 않기 위해서다.
-- 기존 행은 언제 승인을 요청했는지 알 수 없으므로 NULL(B로 취급)로 둔다.
ALTER TABLE payment_attempts
  ADD COLUMN confirm_requested_at DATETIME(6) NULL AFTER failure_reason;
