-- 객실 타입별 보유 수량(재고) 구조 도입 (LDP-62).
--
-- 지금까지는 rooms 한 줄이 실제 방 1개라서, 한 명이 예약하면 그 날은 바로 마감됐다(is_available O/X).
-- 이제 rooms 한 줄을 "객실 타입"으로 보고 보유 수량(total_count)을 두며, 날짜별로 예약된 수(booked_count)를
-- 따로 세서 남은 방(total_count - booked_count)만큼 예약을 받는다.
--
-- is_available은 이제 "관리자 판매 중지" 의미로만 쓴다 (1 = 판매 중, 0 = 판매 중지).
-- 예약·취소는 booked_count만 바꾸고 is_available은 건드리지 않는다 — 그래서 판매 중지한 날의 예약이
-- 취소돼도 판매 중지가 풀리지 않는다 (ERD 위키 "확인 필요" 항목 해소).

-- 객실 타입별 보유 수량. 기존 행은 방 1개였으므로 1.
ALTER TABLE rooms
  ADD COLUMN total_count INT NOT NULL DEFAULT 1 AFTER capacity,
  ADD CONSTRAINT chk_rooms_total_count CHECK (total_count >= 1);

-- 날짜별 예약된 수. 남은 방 = rooms.total_count - booked_count
ALTER TABLE room_availabilities
  ADD COLUMN booked_count INT NOT NULL DEFAULT 0 AFTER is_available,
  ADD CONSTRAINT chk_room_availabilities_booked_count CHECK (booked_count >= 0);

-- 기존 달력은 "예약 0건, 판매 중"으로 시작한다 (이슈 #109 결정 사항).
-- 기존 is_available = 0은 "예약됨"과 "판매 중지"가 섞여 있어 어느 쪽인지 알 수 없으므로 옮기지 않는다.
-- 로컬은 매번 새 DB로 시작하고, dev DB는 Flyway 전환 때 비우기로 해서 살려야 할 기존 예약이 없다.
UPDATE room_availabilities SET is_available = 1, booked_count = 0;
