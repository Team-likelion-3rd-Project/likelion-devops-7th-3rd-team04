-- 부하 테스트 데이터 시드 (LDP-196, 위키 「성능 테스트」 테스트 데이터)
--
-- 부하용 호텔 · 객실 종류 · 호실 · 예약 가능일 · 편의시설과 테스트 사용자를 메인 DB 에 넣는다.
-- backend/scripts/seed.ts 는 건드리지 않고, 테스트 날에만 따로 실행한다 (운영: loadtest-seed-job.yaml, 로컬: README).
-- 이미 있는 행은 건너뛰어 여러 번 실행해도 안전하다 (두 번째 실행은 변경 0건).
--
-- 입력 (실행하는 쪽에서 이 파일 앞에 SET 으로 넣는다)
--   @lt_password_hash  필수. 테스트 사용자 비밀번호의 bcrypt 해시 ($2b$10$...). 레포가 공개라 커밋하지 않는다
--   @lt_units          객실 종류별 호실 수 (기본 300, 최대 999)
--   @lt_days           예약 가능일 수, 오늘부터 (기본 365)
--   @lt_users          테스트 사용자 수 (기본 500)
--
-- 스키마는 backend/migrations (V1 · V6 · V8 · V9) 기준. 컬럼이 바뀌면 이 파일도 같이 고친다.

SET @lt_units = COALESCE(@lt_units, 300);
SET @lt_days = COALESCE(@lt_days, 365);
SET @lt_users = COALESCE(@lt_users, 500);

DELIMITER //
BEGIN NOT ATOMIC
  IF @lt_password_hash IS NULL OR @lt_password_hash NOT LIKE '$2_$%' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '@lt_password_hash(bcrypt 해시)가 없습니다';
  END IF;
  IF @lt_units NOT BETWEEN 1 AND 999 OR @lt_days NOT BETWEEN 1 AND 9999 OR @lt_users NOT BETWEEN 1 AND 9999 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '@lt_units 1~999, @lt_days · @lt_users 1~9999';
  END IF;
END //
DELIMITER ;

-- 0 ~ 9999 숫자 (재귀 CTE 깊이 제한 · Sequence 엔진 유무와 무관하게)
CREATE TEMPORARY TABLE lt_seq (n INT NOT NULL PRIMARY KEY);
INSERT INTO lt_seq (n)
SELECT a.d + b.d * 10 + c.d * 100 + e.d * 1000
FROM (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a
CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b
CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) c
CROSS JOIN (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) e;

-- 임시 테이블 collation 은 메인 DB 테이블(utf8mb4_general_ci)과 맞춘다.
-- MariaDB 11.8(운영 RDS) 기본값 utf8mb4_uca1400_ai_ci 로 만들면 이름 비교에서 Illegal mix of collations

-- 부하용 호텔. k6 는 이름 접두사 「부하테스트」로 찾는다
CREATE TEMPORARY TABLE lt_hotel_def (
  hotel_idx INT NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(255) NOT NULL,
  phone_number VARCHAR(255) NOT NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
INSERT INTO lt_hotel_def VALUES
  (1, '부하테스트 1호점', '부하 테스트 전용 (실제 지점 아님)', '000-0000-0001'),
  (2, '부하테스트 2호점', '부하 테스트 전용 (실제 지점 아님)', '000-0000-0002'),
  (3, '부하테스트 3호점', '부하 테스트 전용 (실제 지점 아님)', '000-0000-0003');

-- 객실 종류. units 가 NULL 이면 @lt_units. 「동시예약 전용룸」은 재고 1개 (테스트 4)
-- weekday_price: 평일 1박 요금, 금 · 토 밤은 1.2배 (seed.ts nightlyPrice 와 같은 규칙)
CREATE TEMPORARY TABLE lt_type_def (
  hotel_idx INT NOT NULL,
  type_idx INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  capacity INT NOT NULL,
  weekday_price INT NOT NULL,
  units INT NULL,
  PRIMARY KEY (hotel_idx, type_idx)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
INSERT INTO lt_type_def VALUES
  (1, 1, '부하 스탠다드 더블', 2, 100000, NULL),
  (1, 2, '부하 디럭스 더블', 2, 120000, NULL),
  (1, 3, '부하 패밀리', 4, 150000, NULL),
  (1, 4, '부하 스위트', 4, 200000, NULL),
  (1, 5, '동시예약 전용룸', 2, 100000, 1),
  (2, 1, '부하 스탠다드 더블', 2, 100000, NULL),
  (2, 2, '부하 디럭스 더블', 2, 120000, NULL),
  (2, 3, '부하 패밀리', 4, 150000, NULL),
  (2, 4, '부하 스위트', 4, 200000, NULL),
  (3, 1, '부하 스탠다드 더블', 2, 100000, NULL),
  (3, 2, '부하 디럭스 더블', 2, 120000, NULL),
  (3, 3, '부하 패밀리', 4, 150000, NULL),
  (3, 4, '부하 스위트', 4, 200000, NULL);

START TRANSACTION;

INSERT INTO hotels (name, address, phone_number, description)
SELECT h.name, h.address, h.phone_number, '부하 테스트 데이터입니다. 테스트 날에만 존재합니다.'
FROM lt_hotel_def h
WHERE NOT EXISTS (SELECT 1 FROM hotels x WHERE x.name = h.name);

-- 편의시설: booking-service 가 이름(수영장 · 라운지)으로 찾는다 (seed.ts FACILITY_SEEDS 와 같은 값)
INSERT INTO facilities (hotel_id, name, price)
SELECT ho.hotelId, f.name, f.price
FROM lt_hotel_def h
JOIN hotels ho ON ho.name = h.name
CROSS JOIN (SELECT '수영장' name, 30000 price UNION ALL SELECT '라운지', 50000) f
WHERE NOT EXISTS (SELECT 1 FROM facilities x WHERE x.hotel_id = ho.hotelId AND x.name = f.name);

-- total_count 는 아래에서 ACTIVE 호실 수로 맞춘다 (보유 수량 = 사용 가능한 호실 수, LDP-82)
INSERT INTO room_types (hotel_id, name, capacity, total_count, description)
SELECT ho.hotelId, t.name, t.capacity, 0, '부하 테스트 객실입니다.'
FROM lt_type_def t
JOIN lt_hotel_def h ON h.hotel_idx = t.hotel_idx
JOIN hotels ho ON ho.name = h.name
WHERE NOT EXISTS (SELECT 1 FROM room_types x WHERE x.hotel_id = ho.hotelId AND x.name = t.name);

-- 호실: 방 번호 = (객실 종류 순번 + 1) + 3자리 순번 (예: 2001 ~ 2300), 층 = 객실 종류 순번 + 1
INSERT INTO rooms (room_type_id, hotel_id, room_number, floor, status)
SELECT rt.room_type_id, rt.hotel_id, CONCAT(t.type_idx + 1, LPAD(s.n, 3, '0')), t.type_idx + 1, 'ACTIVE'
FROM lt_type_def t
JOIN lt_hotel_def h ON h.hotel_idx = t.hotel_idx
JOIN hotels ho ON ho.name = h.name
JOIN room_types rt ON rt.hotel_id = ho.hotelId AND rt.name = t.name
JOIN lt_seq s ON s.n BETWEEN 1 AND COALESCE(t.units, @lt_units)
WHERE NOT EXISTS (
  SELECT 1 FROM rooms x
  WHERE x.hotel_id = rt.hotel_id AND x.room_number = CONCAT(t.type_idx + 1, LPAD(s.n, 3, '0'))
);

UPDATE room_types rt
JOIN hotels ho ON ho.hotelId = rt.hotel_id
JOIN lt_hotel_def h ON h.name = ho.name
SET rt.total_count = (
  SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = rt.room_type_id AND r.status = 'ACTIVE'
);

-- 예약 가능일: 오늘(DB 시간대)부터 @lt_days 일. DAYOFWEEK 6 = 금, 7 = 토
INSERT INTO room_availabilities (room_type_id, date, price, is_available, booked_count)
SELECT rt.room_type_id, d.date,
       IF(DAYOFWEEK(d.date) IN (6, 7), ROUND(t.weekday_price * 1.2), t.weekday_price),
       1, 0
FROM lt_type_def t
JOIN lt_hotel_def h ON h.hotel_idx = t.hotel_idx
JOIN hotels ho ON ho.name = h.name
JOIN room_types rt ON rt.hotel_id = ho.hotelId AND rt.name = t.name
JOIN (SELECT DATE_ADD(CURDATE(), INTERVAL n DAY) date FROM lt_seq WHERE n < @lt_days) d
WHERE NOT EXISTS (
  SELECT 1 FROM room_availabilities x WHERE x.room_type_id = rt.room_type_id AND x.date = d.date
);

-- 테스트 사용자: loadtest-0001@loadtest.example.com ~ (example.com 은 예약된 도메인이라 실제 메일이 가지 않음)
INSERT INTO users (email, name, phone_number, role, status)
SELECT CONCAT('loadtest-', LPAD(s.n, 4, '0'), '@loadtest.example.com'),
       CONCAT('부하테스트', LPAD(s.n, 4, '0')),
       '010-0000-0000', 'USER', 'ACTIVE'
FROM lt_seq s
WHERE s.n BETWEEN 1 AND @lt_users
  AND NOT EXISTS (
    SELECT 1 FROM users x WHERE x.email = CONCAT('loadtest-', LPAD(s.n, 4, '0'), '@loadtest.example.com')
  );

INSERT INTO credentials (userId, passwordHash)
SELECT u.id, @lt_password_hash
FROM users u
WHERE u.email LIKE 'loadtest-%@loadtest.example.com'
  AND NOT EXISTS (SELECT 1 FROM credentials x WHERE x.userId = u.id);

-- 비밀번호를 바꿔 다시 실행하면 해시도 맞춘다 (같은 해시로 다시 실행하면 0건)
UPDATE credentials c
JOIN users u ON u.id = c.userId
SET c.passwordHash = @lt_password_hash
WHERE u.email LIKE 'loadtest-%@loadtest.example.com'
  AND c.passwordHash <> @lt_password_hash;

COMMIT;

-- 결과 요약
SELECT ho.hotelId, ho.name AS hotel, rt.room_type_id, rt.name AS room_type, rt.total_count,
       (SELECT COUNT(*) FROM room_availabilities a WHERE a.room_type_id = rt.room_type_id) AS availability_days
FROM hotels ho
JOIN lt_hotel_def h ON h.name = ho.name
JOIN room_types rt ON rt.hotel_id = ho.hotelId
ORDER BY ho.hotelId, rt.room_type_id;

SELECT COUNT(*) AS loadtest_users,
       SUM(EXISTS (SELECT 1 FROM credentials c WHERE c.userId = u.id)) AS with_credentials
FROM users u
WHERE u.email LIKE 'loadtest-%@loadtest.example.com';

DROP TEMPORARY TABLE lt_seq, lt_hotel_def, lt_type_def;
