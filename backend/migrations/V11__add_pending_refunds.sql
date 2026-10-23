-- 환불 요청 대기열 (LDP-97).
-- pending_refunds: 환불을 결제 서비스에 요청해야 하는 예약. 예약 취소·만료 뒤 승인 이벤트 같은 상황에서
-- 예약 상태 변경과 같은 트랜잭션으로 "환불 필요"를 남기고, 환불 요청 워커가 결제 서비스에 전달될 때까지 재시도한다.
-- (결제 결과 수신기가 환불을 직접 호출하면 큐 처리가 밀리고, 호출이 실패하면 환불이 유실됐다)
-- 예약 ID가 PK라 같은 예약의 환불은 한 번만 쌓인다 — 결제 쪽도 예약 ID로 만든 같은 환불 키로 한 번만 환불한다.

CREATE TABLE pending_refunds (
  reservation_id INT NOT NULL,
  -- 왜 환불하는지 (CANCELLED: 예약 취소 / APPROVED_AFTER_CLOSE: 예약이 끝난 뒤 승인 이벤트가 옴)
  reason VARCHAR(50) NOT NULL,
  -- 결제 서비스 호출 실패 횟수
  attempts INT NOT NULL DEFAULT 0,
  -- 다음에 요청할 시각. 워커가 가져갈 때 잠깐 미래로 미뤄 두어(lease) 여러 대가 같은 건을 동시에 요청하지 않는다
  next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_error VARCHAR(500) NULL,
  -- 결제 서비스가 요청을 받았으면 기록 (그 뒤 환불 결과·재시도는 결제 쪽이 맡고 이벤트로 알려 준다). NULL = 아직
  completed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (reservation_id),
  KEY idx_pending_refunds_due (completed_at, next_attempt_at),
  CONSTRAINT fk_pending_refunds_reservation
    FOREIGN KEY (reservation_id) REFERENCES reservations (reservationId)
    ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
