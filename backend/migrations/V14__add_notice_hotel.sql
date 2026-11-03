-- 지점별 공지 (LDP-188).
-- 지금까지 공지는 모두 전 지점 공통이었다. 지점 관리자(V13 MANAGER)가 자기 지점 공지를 올릴 수 있게 대상 지점을 둔다.
--   hotel_id NULL  전체 공지 — 본사가 올림, 모든 지점 화면에 보임
--   hotel_id 있음  지점 공지 — 그 지점 화면(호텔 상세·공지 필터)에만 보임
-- 기존 공지(seed 6건 포함)는 지금처럼 전체 공지로 둔다 (NULL 그대로).
-- notices와 hotels는 둘 다 hotel-service 소유라 FK를 건다 (ERD 위키 FK 13번).

ALTER TABLE notices
  ADD COLUMN hotel_id INT NULL AFTER category;

-- 공지가 남은 호텔은 삭제 불가 (다른 hotels FK와 같은 RESTRICT). FK가 hotel_id Index를 만든다.
ALTER TABLE notices
  ADD CONSTRAINT fk_notices_hotel
  FOREIGN KEY (hotel_id) REFERENCES hotels (hotelId)
  ON DELETE RESTRICT;
