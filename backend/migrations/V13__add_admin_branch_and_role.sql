-- 관리자 소속 지점·직급 (LDP-176).
-- 지금까지 관리자는 모두 같은 권한으로 전 지점 예약·객실을 다룰 수 있었다. 지점별로 나누고 직급을 둔다.
--   SUPER   본사 — 소속 지점 없음(hotelId NULL), 전 지점 + 회원·계정·공통 공지
--   MANAGER 지점 관리자 — 자기 지점 예약·호실 배정·호텔·객실 + 지점 공지
--   STAFF   직원 — 자기 지점 예약·호실 배정만
-- 실제 권한 검사는 api-gateway가 토큰의 hotelId·adminRole로 한다 (이 마이그레이션은 값만 저장).
-- 소유: user-service. hotels는 hotel-service 소유라 FK를 두지 않는다 (notices.created_by_admin_id와 같은 방식).
-- 이 테이블(V6)은 컬럼 이름이 camelCase라 같은 형식을 따른다.

ALTER TABLE admins
  ADD COLUMN hotelId INT NULL AFTER position,
  ADD COLUMN adminRole ENUM('SUPER', 'MANAGER', 'STAFF') NOT NULL DEFAULT 'STAFF' AFTER hotelId;

-- 이미 있는 관리자(seed로 만든 본사 계정)는 지금처럼 전 지점을 다루도록 본사로 둔다
UPDATE admins SET adminRole = 'SUPER' WHERE hotelId IS NULL;

-- 본사는 소속 지점이 없고, 지점 관리자·직원은 반드시 지점이 있다
ALTER TABLE admins
  ADD CONSTRAINT chk_admins_role_hotel CHECK (
    (adminRole = 'SUPER' AND hotelId IS NULL)
    OR (adminRole <> 'SUPER' AND hotelId IS NOT NULL)
  ),
  ADD KEY idx_admins_hotel (hotelId);
