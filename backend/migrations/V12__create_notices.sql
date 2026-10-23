-- 공지사항 (LDP-147).
-- 지금까지 고객 공지사항·메인 "새로운 소식"은 프론트 코드(frontend/src/data/notices.ts)에 직접 적혀 있어
-- 공지를 고치려면 프론트를 다시 배포해야 했다. 관리자가 화면에서 올리고 고칠 수 있게 테이블로 옮긴다.
-- 소유: hotel-service (호텔·객실과 같은 "보여 주는 콘텐츠"). 첫 공지 6건은 seed가 테이블이 비어 있을 때만 넣는다.

CREATE TABLE notices (
  notice_id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  -- 일반 텍스트 (화면은 HTML로 해석하지 않고 줄바꿈만 살려 보여 준다)
  body TEXT NOT NULL,
  -- 화면 표시: NOTICE = 안내, EVENT = 이벤트, MAINTENANCE = 점검
  category ENUM('NOTICE', 'EVENT', 'MAINTENANCE') NOT NULL,
  -- 중요 공지 — 목록 맨 위에 고정
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  -- 작성한 직원 (admins.adminId, user-service 소유라 FK 없음). seed로 넣은 공지는 NULL
  created_by_admin_id INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (notice_id),
  -- 목록: 고정 먼저, 최신순
  KEY idx_notices_pinned_created (is_pinned, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
