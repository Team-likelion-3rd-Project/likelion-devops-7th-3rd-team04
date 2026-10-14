-- reservations 결제 대기 흐름 확장: 결제 실패/만료 상태 + 결제 마감 시각.
-- payment_due_at은 아직 애플리케이션 코드가 채우지 않으므로(LDP-25에서 구현) NULL 허용으로 추가하고,
-- 기존 행만 생성 시각 + 30분으로 백필한다.

ALTER TABLE reservations
  MODIFY COLUMN status ENUM('PENDING_PAYMENT', 'RESERVED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED', 'COMPLETED')
    NOT NULL DEFAULT 'PENDING_PAYMENT';

ALTER TABLE reservations
  ADD COLUMN payment_due_at DATETIME(6) NULL AFTER status;

UPDATE reservations
  SET payment_due_at = DATE_ADD(createdAt, INTERVAL 30 MINUTE)
  WHERE payment_due_at IS NULL;

-- 만료 배치(LDP-26 이후)가 "결제 대기 중이고 마감이 지난 예약"을 빠르게 찾기 위한 인덱스
CREATE INDEX idx_reservations_status_payment_due_at ON reservations (status, payment_due_at);
