-- 메인 DB 기준선: TypeORM synchronize가 hotel-service/booking-service를 위해 만들던
-- 테이블 구조 그대로입니다 (2026-10-14 기준 엔티티 정의와 동일).
--
-- FK는 아직 없습니다 -- V2에서 같은 서비스 안 FK 5개를 추가합니다.

CREATE TABLE hotels (
  hotelId INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(255) NOT NULL,
  phone_number VARCHAR(255) NOT NULL,
  description TEXT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (hotelId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE rooms (
  roomId INT NOT NULL AUTO_INCREMENT,
  hotel_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  capacity INT NOT NULL,
  description TEXT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (roomId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE facilities (
  facilityId INT NOT NULL AUTO_INCREMENT,
  hotel_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  price INT NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (facilityId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE room_images (
  imageId INT NOT NULL AUTO_INCREMENT,
  room_id INT NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  image_base64 LONGTEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (imageId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE room_availabilities (
  room_id INT NOT NULL,
  date DATE NOT NULL,
  price INT NOT NULL,
  is_available TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (room_id, date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE reservations (
  reservationId INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  room_id INT NOT NULL,
  hotel_id INT NULL,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  guest_count INT NOT NULL,
  total_amount INT NOT NULL,
  status ENUM('PENDING_PAYMENT', 'RESERVED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'PENDING_PAYMENT',
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (reservationId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE reservation_facilities (
  reservationFacilityId INT NOT NULL AUTO_INCREMENT,
  reservation_id INT NOT NULL,
  facility_id INT NOT NULL,
  facility_name VARCHAR(255) NOT NULL,
  guest_count INT NOT NULL,
  total_amount INT NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (reservationFacilityId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
