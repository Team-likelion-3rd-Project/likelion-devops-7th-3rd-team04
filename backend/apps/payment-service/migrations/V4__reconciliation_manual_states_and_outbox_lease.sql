-- 결제 대사 배치·결과 이벤트 발행 보강 (LDP-97).
--  1) 상태 REFUND_MANUAL_REQUIRED: 환불을 최대 횟수만큼 다시 시도해도 실패했거나 자동으로 다시 시도할 수 없는 환불을
--     자동 재시도 대상(REFUND_FAILED)에서 빼 운영자 수동 처리 대상으로 옮긴다.
--  2) 상태 UNKNOWN_MANUAL_REQUIRED: 결과 불명 결제를 기한(24시간)까지 확정하지 못하면 자동 조회를 멈추고 수동 확인으로 넘긴다.
--     돈이 빠졌는지 모르는 상태라 "예약당 승인 결제 1건" 대상(approved_reservation_id)에 넣지 않는다.
--  3) 대사 배치 다음 조회 시각·조회 횟수: 확정되지 않은 결제를 매번 조회하지 않고 간격을 늘려 가며 조회한다.
--  4) payment_outbox.locked_until: 발행기가 행을 잠깐 맡아 두는 표시(lease). 행 잠금을 쥔 채 큐로 보내지 않도록,
--     맡기만 하고 커밋한 뒤 트랜잭션 밖에서 보낸다.
-- MariaDB의 DDL은 되돌릴 수 없어 중간에 실패하면 반쯤 적용된 상태가 남는다 — 테이블마다 ALTER 하나씩으로 묶었다.

-- payments: 생성 컬럼이 참조하는 status를 바꾸기 전에 생성 컬럼과 UNIQUE를 먼저 내린다
ALTER TABLE payments
  DROP KEY uk_approved_reservation,
  DROP COLUMN approved_reservation_id;

-- payments: 상태 추가(기존 값 순서는 그대로, 맨 뒤에), 생성 컬럼·UNIQUE 다시 만들기(V2 정의 + REFUND_MANUAL_REQUIRED),
-- 대사 배치 조회 칸 추가
ALTER TABLE payments
  MODIFY status ENUM(
    'PROCESSING', 'APPROVED', 'FAILED', 'UNKNOWN',
    'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED',
    'REFUND_MANUAL_REQUIRED', 'UNKNOWN_MANUAL_REQUIRED'
  ) NOT NULL DEFAULT 'PROCESSING',
  ADD COLUMN approved_reservation_id INT AS (
    IF(status IN ('APPROVED', 'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED', 'REFUND_MANUAL_REQUIRED'), reservation_id, NULL)
  ) PERSISTENT AFTER status,
  ADD COLUMN reconcile_attempts INT NOT NULL DEFAULT 0 COMMENT '결과 불명 결제를 대사 배치가 조회한 횟수' AFTER raw_response,
  ADD COLUMN next_reconcile_at DATETIME(6) NULL COMMENT '대사 배치가 다음에 볼 시각 (NULL = updatedAt 기준)' AFTER reconcile_attempts,
  ADD UNIQUE KEY uk_approved_reservation (approved_reservation_id),
  ADD KEY idx_payments_status_next_reconcile_at (status, next_reconcile_at);

-- payment_outbox: lease + 같은 예약의 앞선 미발행 이벤트를 찾는 인덱스(예약별 순서 보장)
ALTER TABLE payment_outbox
  ADD COLUMN locked_until DATETIME(6) NULL COMMENT '발행기가 맡아 둔 기한 (NULL·지남 = 누구나 가져갈 수 있음)' AFTER published_at,
  ADD KEY idx_payment_outbox_reservation_unpublished (reservation_id, published_at, created_at);
