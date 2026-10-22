-- 결제 상태 REFUND_MANUAL_REQUIRED 추가 (LDP-97): 대사 배치가 환불을 최대 횟수만큼 다시 시도해도 실패했거나
-- 자동으로 다시 시도할 수 없는 환불을, 자동 재시도 대상(REFUND_FAILED)에서 빼 운영자 수동 처리 대상으로 옮긴다.

-- 1) 승인 이후 상태 목록에 새 상태를 넣는다. 빠지면 approved_reservation_id가 NULL이 되어
--    "예약당 승인 결제 1건" UNIQUE가 풀리고, 환불 요청이 이 결제를 찾지 못한다(NO_PAYMENT).
--    생성 컬럼이 참조하는 status를 바꾸기 전에 생성 컬럼과 UNIQUE를 먼저 내리고, 바꾼 뒤 다시 만든다.
ALTER TABLE payments
  DROP KEY uk_approved_reservation,
  DROP COLUMN approved_reservation_id;

-- 2) 상태 ENUM에 값 추가 (기존 값 순서는 그대로, 맨 뒤에 추가)
ALTER TABLE payments
  MODIFY status ENUM(
    'PROCESSING', 'APPROVED', 'FAILED', 'UNKNOWN',
    'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED',
    'REFUND_MANUAL_REQUIRED'
  ) NOT NULL DEFAULT 'PROCESSING';

-- 3) 생성 컬럼·UNIQUE 다시 만들기 (V2와 같은 정의 + REFUND_MANUAL_REQUIRED)
ALTER TABLE payments
  ADD COLUMN approved_reservation_id INT AS (
    IF(status IN ('APPROVED', 'REFUND_REQUESTED', 'REFUND_FAILED', 'REFUNDED', 'REFUND_MANUAL_REQUIRED'), reservation_id, NULL)
  ) PERSISTENT AFTER status,
  ADD UNIQUE KEY uk_approved_reservation (approved_reservation_id);
