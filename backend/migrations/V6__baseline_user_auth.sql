-- user-service / auth-service 테이블 기준선: TypeORM synchronize가 두 서비스를 위해 만들던
-- 테이블 구조 그대로입니다 (2026-10-15 기준 엔티티로 synchronize 해서 뽑은 SHOW CREATE TABLE과 동일).
--
-- 이 파일 전까지는 user/auth가 synchronize: true로 이 테이블들을 직접 만들었는데, Flyway보다 먼저
-- 뜨면 "non-empty schema but no schema history"로 Flyway가 멈추는 문제가 있었습니다(LDP-60).
-- 이제 메인 DB의 모든 테이블을 Flyway만 만들고, user/auth도 synchronize: false입니다.
--
-- UNIQUE 인덱스 이름만 TypeORM 자동 이름(IDX_...) 대신 읽기 쉬운 이름으로 바꿨습니다(구조는 동일).
-- 서비스 경계를 넘는 참조(credentials.userId -> users.id, admin_credentials.adminId -> admins.id)는
-- 원칙대로 FK를 걸지 않습니다.

-- user-service: 고객 프로필
CREATE TABLE users (
  id INT NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(255) NOT NULL,
  role ENUM('USER') NOT NULL DEFAULT 'USER',
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

-- user-service: 탈퇴 회원 백업 (original_id = 탈퇴 전 users.id)
CREATE TABLE deleted_user (
  id INT NOT NULL AUTO_INCREMENT,
  original_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(255) NOT NULL,
  role ENUM('USER') NOT NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL,
  original_created_at DATETIME NOT NULL,
  original_updated_at DATETIME NOT NULL,
  deleted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

-- user-service: 관리자 프로필 (고객 users와 별개 테이블)
CREATE TABLE admins (
  id INT NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  department VARCHAR(255) NULL,
  position VARCHAR(255) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_admins_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

-- auth-service: 고객 비밀번호 해시 (회원 1명당 1개)
CREATE TABLE credentials (
  id INT NOT NULL AUTO_INCREMENT,
  userId INT NOT NULL,
  passwordHash VARCHAR(255) NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_credentials_user_id (userId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

-- auth-service: 관리자 비밀번호 해시
CREATE TABLE admin_credentials (
  id INT NOT NULL AUTO_INCREMENT,
  adminId INT NOT NULL,
  passwordHash VARCHAR(255) NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_credentials_admin_id (adminId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
