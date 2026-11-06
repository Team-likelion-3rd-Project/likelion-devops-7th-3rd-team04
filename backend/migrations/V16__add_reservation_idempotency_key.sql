-- 예약 생성 멱등 키 (LDP-240).
-- 예약 요청이 503(gateway gRPC 기한 초과 등)으로 끝나도 booking-service는 예약을 저장할 수 있다.
-- 화면은 실패로 보고 다시 누르게 되는데, 요청을 구분할 값이 없어 같은 예약이 하나 더 생겼다.
-- 이제 화면이 "예약 시도"마다 키를 만들어 Idempotency-Key 헤더로 보내고(다시 누르면 같은 키),
-- 같은 회원·같은 키의 예약이 이미 있으면 새로 만들지 않고 그 예약을 돌려준다.
--
-- 키는 회원별로만 겹치지 않으면 된다 → UNIQUE (user_id, idempotency_key).
-- 키 없이 만든 예약(기존 행, 관리자 대리·연장 예약)은 NULL이고, NULL끼리는 UNIQUE에 걸리지 않는다.
-- 컬럼 추가만 하므로 이전 버전 서비스가 함께 돌아도 문제없다 (expand 단계).

ALTER TABLE reservations
  ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER cancel_reason,
  ADD UNIQUE KEY uk_reservations_user_idempotency_key (user_id, idempotency_key);
