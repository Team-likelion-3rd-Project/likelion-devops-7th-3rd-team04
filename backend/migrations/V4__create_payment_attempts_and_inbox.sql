-- booking-service가 결제 흐름을 추적하기 위한 테이블 2개 (ERD 위키 "booking-service" 섹션).
-- FK 6~8번 (같은 서비스 안이라 실제 FK를 건다).

-- FK 6: payment_attempts.reservation_id -> reservations.reservationId
CREATE TABLE payment_attempts (
  attempt_id BIGINT NOT NULL AUTO_INCREMENT,
  reservation_id INT NOT NULL,
  -- payment-service 호출 시 PrivateLink 헤더에 싣는 멱등 키. 같은 시도가 두 번 INSERT되는 것을 막는다.
  idempotency_key CHAR(36) NOT NULL,
  -- 시도마다 새로 발급하는 토스 주문번호. 재시도해도 이전 시도와 충돌하지 않는다.
  pg_order_id VARCHAR(255) NOT NULL,
  -- 프론트에서 받은 금액. 승인 시 결제 서버가 아는 금액과 대조해 위변조를 거른다.
  amount INT NOT NULL,
  status ENUM('REQUESTED', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'REQUESTED',
  failure_reason VARCHAR(255) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (attempt_id),
  UNIQUE KEY uq_payment_attempts_idempotency_key (idempotency_key),
  UNIQUE KEY uq_payment_attempts_pg_order_id (pg_order_id),
  CONSTRAINT fk_payment_attempts_reservation
    FOREIGN KEY (reservation_id) REFERENCES reservations (reservationId)
    ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

-- FK 7: payment_result_inbox.reservation_id -> reservations.reservationId
-- FK 8: payment_result_inbox.attempt_id -> payment_attempts.attempt_id
CREATE TABLE payment_result_inbox (
  inbox_id BIGINT NOT NULL AUTO_INCREMENT,
  -- payment-service의 payment_outbox.event_id와 같은 값. UNIQUE라 같은 이벤트가 중복 수신돼도 한 번만 반영된다.
  event_id CHAR(36) NOT NULL,
  event_type ENUM('PAYMENT_APPROVED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'PAYMENT_REFUND_FAILED') NOT NULL,
  reservation_id INT NOT NULL,
  -- 환불 이벤트는 특정 시도와 연결되지 않아 비어 있을 수 있다.
  attempt_id BIGINT NULL,
  -- 결제 DB의 payments.paymentId를 가리킨다. 서비스 경계를 넘는 참조라 FK는 걸지 않는다.
  payment_id INT NOT NULL,
  payload JSON NOT NULL,
  received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  -- NULL이면 아직 처리 안 됨
  processed_at DATETIME(6) NULL,
  PRIMARY KEY (inbox_id),
  UNIQUE KEY uq_payment_result_inbox_event_id (event_id),
  CONSTRAINT fk_payment_result_inbox_reservation
    FOREIGN KEY (reservation_id) REFERENCES reservations (reservationId)
    ON DELETE RESTRICT,
  CONSTRAINT fk_payment_result_inbox_attempt
    FOREIGN KEY (attempt_id) REFERENCES payment_attempts (attempt_id)
    ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
