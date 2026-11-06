-- 재고 잠금 집중 테스트 준비 (LDP-242, 부하 테스트 3차, k6/hotspot.js)
--
-- hotel-service reserveRoomAvailability 는 같은 객실 종류 × 날짜의 room_availabilities 행을
-- 배타 잠금(pessimistic_write)으로 잡은 뒤 확인한다. 매진이어도 잠금을 먼저 잡으므로,
-- 매진 상태로 만들어 두면 "같은 행에 몰릴 때"와 "흩어질 때"를 재고 소진 없이 몇 분씩 비교할 수 있다.
--
--   ① spread · ② hot : 「동시예약 전용룸」(1실) 의 내일부터 @hp_days 일을 매진 상태로 (booked_count = total_count)
--   ③ burst         : 부하테스트 1호점에 「집중 성공룸」 999실 + 오늘부터 365일 가용 (성공 경로 · 오버부킹 확인)
--
-- loadtest-seed.sql 다음에 실행한다. 여러 번 실행해도 안전하다 (③ 은 이미 있으면 건너뜀, ① ② 는 다시 매진으로).
-- 재고 초기화(reset.sql)는 부하용 호텔 booked_count 를 0 으로 되돌리므로, 그 뒤에는 이 파일을 다시 실행한다.

SET @hp_days = 200;
SET @hp_units = 999;

-- 0 ~ 999 숫자
CREATE TEMPORARY TABLE hp_seq (n INT NOT NULL PRIMARY KEY);
INSERT INTO hp_seq (n)
SELECT a.d + b.d * 10 + c.d * 100
FROM (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a
CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b
CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) c;

START TRANSACTION;

-- ① ② 매진 경로 대상
UPDATE room_availabilities a
JOIN room_types rt ON rt.room_type_id = a.room_type_id
JOIN hotels h ON h.hotelId = rt.hotel_id
SET a.booked_count = rt.total_count
WHERE h.name = '부하테스트 1호점'
  AND rt.name = '동시예약 전용룸'
  AND a.date BETWEEN DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND DATE_ADD(CURDATE(), INTERVAL @hp_days DAY);
SELECT ROW_COUNT() AS soldout_rows_set;

-- ③ 성공 경로 대상: 객실 종류 → 호실(9001 ~ 9999, 9층) → 보유 수량 → 예약 가능일
INSERT INTO room_types (hotel_id, name, capacity, total_count, description)
SELECT h.hotelId, '집중 성공룸', 2, 0, '재고 잠금 집중 테스트 객실입니다 (테스트 날에만 존재).'
FROM hotels h
WHERE h.name = '부하테스트 1호점'
  AND NOT EXISTS (SELECT 1 FROM room_types x WHERE x.hotel_id = h.hotelId AND x.name = '집중 성공룸');

INSERT INTO rooms (room_type_id, hotel_id, room_number, floor, status)
SELECT rt.room_type_id, rt.hotel_id, CONCAT('9', LPAD(s.n, 3, '0')), 9, 'ACTIVE'
FROM room_types rt
JOIN hotels h ON h.hotelId = rt.hotel_id
JOIN hp_seq s ON s.n BETWEEN 1 AND @hp_units
WHERE h.name = '부하테스트 1호점' AND rt.name = '집중 성공룸'
  AND NOT EXISTS (
    SELECT 1 FROM rooms x WHERE x.hotel_id = rt.hotel_id AND x.room_number = CONCAT('9', LPAD(s.n, 3, '0'))
  );

UPDATE room_types rt
JOIN hotels h ON h.hotelId = rt.hotel_id
SET rt.total_count = (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = rt.room_type_id AND r.status = 'ACTIVE')
WHERE h.name = '부하테스트 1호점' AND rt.name = '집중 성공룸';

INSERT INTO room_availabilities (room_type_id, date, price, is_available, booked_count)
SELECT rt.room_type_id, DATE_ADD(CURDATE(), INTERVAL s.n DAY), 100000, 1, 0
FROM room_types rt
JOIN hotels h ON h.hotelId = rt.hotel_id
JOIN hp_seq s ON s.n < 365
WHERE h.name = '부하테스트 1호점' AND rt.name = '집중 성공룸'
  AND NOT EXISTS (
    SELECT 1 FROM room_availabilities x WHERE x.room_type_id = rt.room_type_id AND x.date = DATE_ADD(CURDATE(), INTERVAL s.n DAY)
  );

COMMIT;

-- 확인: 두 객실 종류의 보유 수량 · 매진 일수 · 가용 일수
SELECT rt.room_type_id, rt.name AS room_type, rt.total_count,
       SUM(a.booked_count >= rt.total_count) AS soldout_days,
       SUM(a.booked_count < rt.total_count AND a.is_available = 1) AS open_days
FROM room_types rt
JOIN hotels h ON h.hotelId = rt.hotel_id
JOIN room_availabilities a ON a.room_type_id = rt.room_type_id
WHERE h.name = '부하테스트 1호점' AND rt.name IN ('동시예약 전용룸', '집중 성공룸')
GROUP BY rt.room_type_id, rt.name, rt.total_count;
