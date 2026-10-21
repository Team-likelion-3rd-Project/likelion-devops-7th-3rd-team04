-- 객실 이미지를 DB(base64)가 아닌 저장소(dev MinIO · prod S3)에 두고, DB에는 경로만 저장 (LDP-88).
--
-- 지금까지는 room_images.image_base64(LONGTEXT)에 사진 파일 자체를 저장해서, 객실 목록 API가 사진
-- 데이터를 통째로 내려주고 DB 용량·백업도 무거워졌다. 이제 사진은 저장소에 두고 object_key(경로,
-- 예: room-types/12/0f3c....jpg)만 저장한다. 저장소 버킷은 비공개라, hotel-service가 object_key로
-- 보기·올리기용 Presigned URL을 만들어 준다. 주소(엔드포인트)는 환경마다 달라서 DB에 넣지 않는다.
--
-- ⚠️ 기존 base64 사진은 SQL로 저장소에 옮길 수 없어서 지운다. 10-16 기준 로컬·팀 서버 모두
-- room_images 0건이라(ERD 위키) 실제로 지워지는 데이터는 없다.
--
-- 위키 ERD(LDP-82 #161)의 object_key와 같은 구조다. room_id → room_type_id 이름 변경은
-- 객실 구조 마이그레이션(V9, LDP-86 #168)에서 한다. 두 마이그레이션 모두 room_images를 건드려서
-- 순서를 지켜야 하므로, 객실 구조 = V9 · 이미지 = V10으로 정했다(10-20 김좌형).

DELETE FROM room_images;

ALTER TABLE room_images
  DROP COLUMN image_base64,
  ADD COLUMN object_key VARCHAR(512) NOT NULL AFTER mime_type;
