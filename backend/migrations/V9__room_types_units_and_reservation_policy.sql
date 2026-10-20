-- 객실 구조 확정 + 예약 정책 칸 추가 (LDP-86, 위키 ERD LDP-82 #161 · LDP-83 #162).
--
-- ① 객실 종류와 실제 호실을 이름으로 나눈다.
--    V8부터 rooms 한 줄은 실제 방이 아니라 "객실 종류"였는데 이름이 그대로라, 호실(101호 등)을 추가하면
--    "room"이 두 가지 뜻으로 섞인다. 그래서 객실 종류 = room_types, 실제 호실 = rooms 로 정리한다.
--      rooms(roomId)                 → room_types(room_type_id)
--      room_images.room_id           → room_type_id
--      room_availabilities.room_id   → room_type_id
--      reservations.room_id          → room_type_id   (예약한 객실 종류)
--      (새 테이블) rooms              = 실제 호실, reservations.room_id = 배정된 호실
--    이름만 바꾸므로 기존 객실·재고·예약 데이터는 그대로 유지된다.
--    보유 수량(total_count)은 이제 "사용 가능한(ACTIVE) 호실 수"라서, 호실이 아직 없는 객실 종류는 0이 될 수 있다
--    → CHECK를 >= 1 에서 >= 0 으로 바꾼다. 기존 값은 건드리지 않고, 시드가 보유 수량만큼 호실을 만들어 맞춘다.
--
-- ② 예약 정책 칸 (모두 NULL 허용, 기존 예약은 비어 있음)
--      room_id               배정된 호실 (직원이 나중에 배정, 서비스 경계라 FK 없음)
--      linked_reservation_id 연장 예약이면 원래 예약 (같은 테이블 자기 참조 FK)
--      created_by_admin_*    대리 예약을 만든 직원 (admins는 user-service 소유라 FK 없음, 이름은 스냅샷)
--      cancelled_by_admin_id, cancel_reason  직원 취소 기록
--
-- 이미지 S3 전환(LDP-88)은 room_images의 이미지 칸만 바꾸는 다음 번호 마이그레이션에서 진행한다.

-- ────────────────────────────── ① 객실 종류: rooms → room_types
-- 이름을 바꿀 컬럼을 가리키는 FK를 먼저 풀고, 이름을 바꾼 뒤 새 이름으로 다시 건다.
ALTER TABLE room_images DROP FOREIGN KEY fk_room_images_room;
ALTER TABLE room_availabilities DROP FOREIGN KEY fk_room_availabilities_room;
ALTER TABLE rooms DROP FOREIGN KEY fk_rooms_hotel;

RENAME TABLE rooms TO room_types;

ALTER TABLE room_types
  RENAME COLUMN roomId TO room_type_id,
  RENAME INDEX fk_rooms_hotel TO fk_room_types_hotel,
  DROP CONSTRAINT chk_rooms_total_count,
  ADD CONSTRAINT chk_room_types_total_count CHECK (total_count >= 0);
ALTER TABLE room_types
  ADD CONSTRAINT fk_room_types_hotel
  FOREIGN KEY (hotel_id) REFERENCES hotels (hotelId)
  ON DELETE RESTRICT;

ALTER TABLE room_images
  RENAME COLUMN room_id TO room_type_id,
  RENAME INDEX fk_room_images_room TO fk_room_images_room_type;
ALTER TABLE room_images
  ADD CONSTRAINT fk_room_images_room_type
  FOREIGN KEY (room_type_id) REFERENCES room_types (room_type_id)
  ON DELETE CASCADE;

-- (room_type_id, date)가 복합 PK라 FK는 PK 인덱스를 그대로 쓴다.
ALTER TABLE room_availabilities
  RENAME COLUMN room_id TO room_type_id;
ALTER TABLE room_availabilities
  ADD CONSTRAINT fk_room_availabilities_room_type
  FOREIGN KEY (room_type_id) REFERENCES room_types (room_type_id)
  ON DELETE CASCADE;

ALTER TABLE reservations
  RENAME COLUMN room_id TO room_type_id,
  RENAME INDEX idx_reservations_room_id_check_in_date TO idx_reservations_room_type_id_check_in_date;

-- ────────────────────────────── ① 실제 호실: 새 rooms
-- hotel_id는 room_types.hotel_id와 같은 값(코드에서 맞춤). 같은 지점에 같은 방 번호를 막는 UNIQUE에 쓴다.
CREATE TABLE rooms (
  room_id INT NOT NULL AUTO_INCREMENT,
  room_type_id INT NOT NULL,
  hotel_id INT NOT NULL,
  room_number VARCHAR(20) NOT NULL,
  floor INT NULL,
  status ENUM('ACTIVE', 'OUT_OF_SERVICE') NOT NULL DEFAULT 'ACTIVE',
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (room_id),
  UNIQUE KEY uk_rooms_hotel_room_number (hotel_id, room_number),
  KEY idx_rooms_room_type_status (room_type_id, status),
  -- 호실이 남은 객실 종류는 삭제할 수 없다 (배정된 예약이 엉키지 않게, ERD FK 10)
  CONSTRAINT fk_rooms_room_type
    FOREIGN KEY (room_type_id) REFERENCES room_types (room_type_id)
    ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

-- ────────────────────────────── ② 예약 정책 칸
ALTER TABLE reservations
  ADD COLUMN room_id INT NULL AFTER room_type_id,
  ADD COLUMN linked_reservation_id INT NULL AFTER payment_due_at,
  ADD COLUMN created_by_admin_id INT NULL AFTER linked_reservation_id,
  ADD COLUMN created_by_admin_name VARCHAR(100) NULL AFTER created_by_admin_id,
  ADD COLUMN cancelled_by_admin_id INT NULL AFTER created_by_admin_name,
  ADD COLUMN cancel_reason VARCHAR(255) NULL AFTER cancelled_by_admin_id,
  -- 호실 배정 시 같은 호실·겹치는 기간 예약 확인, 호실 현황 조회
  ADD KEY idx_reservations_room_id_check_in_date (room_id, check_in_date),
  -- 원래 예약의 연장분 조회 (ERD FK 11)
  ADD CONSTRAINT fk_reservations_linked_reservation
    FOREIGN KEY (linked_reservation_id) REFERENCES reservations (reservationId)
    ON DELETE RESTRICT;
