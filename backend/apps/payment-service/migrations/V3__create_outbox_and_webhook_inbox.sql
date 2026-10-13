-- 결제 결과 이벤트 Outbox와 PG 웹훅 Inbox (ERD 위키 결제 DB V3).

-- payment_outbox: 결제 상태를 바꾸는 트랜잭션 안에서 같이 INSERT 합니다. 발행기가
-- FOR UPDATE SKIP LOCKED로 미발행 행(published_at IS NULL)을 가져가 SQS FIFO로 보낸 뒤
-- published_at을 기록합니다. event_id는 SQS 중복 제거 ID, reservation_id는 FIFO 그룹 ID로 씁니다.
CREATE TABLE payment_outbox (
  event_id CHAR(36) NOT NULL,
  event_type VARCHAR(50) NOT NULL COMMENT 'PAYMENT_APPROVED / PAYMENT_FAILED / PAYMENT_REFUNDED / PAYMENT_REFUND_FAILED',
  reservation_id INT NOT NULL,
  payment_id INT NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  published_at DATETIME(6) NULL COMMENT 'NULL = 아직 발행 안 됨',
  PRIMARY KEY (event_id),
  KEY idx_payment_outbox_unpublished (published_at, created_at),
  CONSTRAINT fk_payment_outbox_payment FOREIGN KEY (payment_id)
    REFERENCES payments (paymentId) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

-- pg_webhook_inbox: PG(토스) 웹훅 원본을 먼저 기록하고, 토스 조회 API로 재확인한 뒤 처리합니다.
-- 우리 DB에 없는 결제에 대한 웹훅(가짜 포함)도 일단 기록해야 하므로 payments로의 FK는 없습니다.
CREATE TABLE pg_webhook_inbox (
  inbox_id BIGINT NOT NULL AUTO_INCREMENT,
  pg_event_key VARCHAR(255) NOT NULL COMMENT '웹훅 추적 ID (중복 수신 방지)',
  event_type VARCHAR(100) NOT NULL,
  headers JSON NULL,
  body JSON NOT NULL COMMENT '원본 본문',
  received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at DATETIME(6) NULL COMMENT 'NULL = 아직 처리 안 됨',
  PRIMARY KEY (inbox_id),
  UNIQUE KEY uk_pg_webhook_inbox_pg_event_key (pg_event_key),
  KEY idx_pg_webhook_inbox_processed_at (processed_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
