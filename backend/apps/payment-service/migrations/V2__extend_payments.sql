-- payments 확장 (ERD 위키 결제 DB V2): 토스 연동·멱등성에 필요한 컬럼, 상태 7종, 예약당 승인 1건 제약.

-- 1) 상태값 2종(소문자) -> 7종(대문자)
--    MariaDB의 기본 정렬 규칙은 대소문자를 구분하지 않아서 ENUM('refunded', 'REFUNDED')처럼 한 번에
--    섞어 선언하면 "중복 값" 오류가 납니다. 그래서 문자열로 잠깐 바꿔서 값을 변환한 뒤 새 ENUM으로 바꿉니다.
--    아래 UPDATE들의 "updatedAt = updatedAt"은 ON UPDATE CURRENT_TIMESTAMP 때문에 기존 행의 수정 시각이
--    마이그레이션 실행 시각으로 덮어써지는 것을 막습니다.
ALTER TABLE payments MODIFY status VARCHAR(20) NOT NULL;

UPDATE payments SET status = 'APPROVED', updatedAt = updatedAt WHERE status = 'paid';
UPDATE payments SET status = 'REFUNDED', updatedAt = updatedAt WHERE status = 'refunded';

ALTER TABLE payments
  MODIFY status ENUM(
    'PROCESSING', 'APPROVED', 'FAILED', 'UNKNOWN',
    'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED'
  ) NOT NULL DEFAULT 'PROCESSING';

-- 2) 신규 컬럼
--    idempotency_key / pg_order_id 는 기존 행이 있으면 NOT NULL을 걸 수 없으므로 NULL로 추가 -> 채움 -> NOT NULL 순서로 바꿉니다.
ALTER TABLE payments
  ADD COLUMN idempotency_key CHAR(36) NULL AFTER user_id,
  ADD COLUMN pg_order_id VARCHAR(64) NULL AFTER idempotency_key,
  ADD COLUMN provider ENUM('MOCK', 'TOSS') NOT NULL DEFAULT 'MOCK' AFTER pg_order_id,
  ADD COLUMN refund_idempotency_key CHAR(36) NULL AFTER status,
  ADD COLUMN raw_response JSON NULL AFTER refund_idempotency_key,
  ADD COLUMN refunded_at DATETIME NULL AFTER paid_at;

-- 기존 행: 멱등 키는 새로 발급하고, 주문번호는 2차 코드가 pg-mock에 보내던 값(예약 ID)을 그대로 씁니다.
-- 환불 시각은 따로 기록된 적이 없어서, 환불 처리 때 마지막으로 바뀐 시각(updatedAt)으로 채웁니다.
UPDATE payments SET idempotency_key = UUID(), updatedAt = updatedAt WHERE idempotency_key IS NULL;
UPDATE payments SET pg_order_id = CAST(reservation_id AS CHAR), updatedAt = updatedAt WHERE pg_order_id IS NULL;
UPDATE payments SET refunded_at = updatedAt, updatedAt = updatedAt WHERE status = 'REFUNDED' AND refunded_at IS NULL;

ALTER TABLE payments
  MODIFY idempotency_key CHAR(36) NOT NULL,
  MODIFY pg_order_id VARCHAR(64) NOT NULL;

-- 3) 승인 전(PROCESSING)에는 아직 없는 값들 -> NULL 허용
ALTER TABLE payments
  MODIFY payment_key VARCHAR(255) NULL,
  MODIFY approval_number VARCHAR(255) NULL,
  MODIFY paid_at DATETIME NULL;

-- 4) 예약당 승인 결제 1건: 승인 이후 상태일 때만 reservation_id 값을 갖는 생성 컬럼에 UNIQUE를 겁니다.
--    FAILED 등은 NULL이 되어 같은 예약에 여러 건이 있어도 됩니다 (UNIQUE는 NULL 중복을 허용).
ALTER TABLE payments
  ADD COLUMN approved_reservation_id INT AS (
    IF(status IN ('APPROVED', 'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED'), reservation_id, NULL)
  ) PERSISTENT AFTER status;

-- 5) UNIQUE / Index (ERD 위키 "FK · Index")
ALTER TABLE payments
  ADD UNIQUE KEY uk_payments_idempotency_key (idempotency_key),
  ADD UNIQUE KEY uk_payments_payment_key (payment_key),
  ADD UNIQUE KEY uk_payments_refund_idempotency_key (refund_idempotency_key),
  ADD UNIQUE KEY uk_approved_reservation (approved_reservation_id),
  ADD KEY idx_payments_reservation_id (reservation_id),
  ADD KEY idx_payments_user_id (user_id),
  ADD KEY idx_payments_status_updated_at (status, updatedAt);
