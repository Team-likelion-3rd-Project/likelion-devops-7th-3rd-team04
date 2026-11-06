-- 내 결제 목록 정렬·페이지용 인덱스 (부하 테스트 3일차 11-06).
-- GET /api/payments/me 는 user_id 로 거른 뒤 paid_at 최신순으로 정렬한다. user_id 단일 인덱스로는
-- 그 회원의 결제를 전부 읽어 정렬(filesort)해야 해서, 결제가 쌓일수록 느려지고 페이지를 나눠도 비용이 그대로다.
--
-- 기존 idx_payments_user_id(V2)는 새 인덱스의 앞부분과 같아 지운다.
-- 인덱스만 바꾸므로 이전 버전 서비스가 함께 돌아도 문제없다.

ALTER TABLE payments
  ADD KEY idx_payments_user_id_paid_at (user_id, paid_at),
  DROP KEY idx_payments_user_id;
