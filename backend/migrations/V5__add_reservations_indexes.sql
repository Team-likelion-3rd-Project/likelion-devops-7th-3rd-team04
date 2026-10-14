-- ERD 위키 V2 설계("FK 5개+인덱스")에서 빠졌던 reservations 조회 인덱스 2개를 뒤늦게 추가.
-- (status, payment_due_at)은 V3에서 이미 추가됨 — 이번엔 나머지 둘만 추가.

-- "내 예약 조회"(GET /api/bookings/me 등)가 user_id로 필터링할 때 쓰는 인덱스
CREATE INDEX idx_reservations_user_id ON reservations (user_id);

-- 특정 객실의 특정 기간 예약 여부 조회(검색)에 쓰는 복합 인덱스
CREATE INDEX idx_reservations_room_id_check_in_date ON reservations (room_id, check_in_date);
