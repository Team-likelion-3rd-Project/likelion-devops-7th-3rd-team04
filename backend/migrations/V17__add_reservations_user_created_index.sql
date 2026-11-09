-- 내 예약 목록 정렬·페이지용 인덱스 (부하 테스트 3일차 11-06).
-- GET /api/bookings/me 는 user_id 로 거른 뒤 createdAt 최신순으로 정렬한다. user_id 단일 인덱스로는
-- 그 회원의 예약을 전부 읽어 정렬(filesort)해야 해서, 예약이 쌓일수록 느려지고 페이지를 나눠도 비용이 그대로다.
-- (user_id, createdAt) 이면 인덱스 순서대로 읽다가 페이지 크기만큼에서 멈출 수 있다.
--
-- 기존 idx_reservations_user_id(V5)는 새 인덱스의 앞부분과 같아 지운다 (user_id 로만 찾는 조회도 새 인덱스를 쓴다).
-- user_id 에는 FK 가 없어(서비스 경계, V2 참고) 인덱스를 지워도 막히지 않는다.
-- 인덱스만 바꾸므로 이전 버전 서비스가 함께 돌아도 문제없다.

ALTER TABLE reservations
  ADD INDEX idx_reservations_user_id_created_at (user_id, createdAt),
  DROP INDEX idx_reservations_user_id;
