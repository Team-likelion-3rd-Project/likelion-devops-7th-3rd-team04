-- 수영장 · 라운지 성인 · 소인 요금 분리 (LDP-247).
-- 시설을 소인용으로 하나씩 더 두는 방식이라 테이블 구조는 바뀌지 않는다.
-- 기존 시설 이름(수영장 · 라운지)은 성인 요금으로 그대로 둔다 — 배포 중인 이전 버전 서비스가 이름으로
-- 요금을 찾아도 실패하지 않고, 이미 저장된 예약 내역(reservation_facilities의 이름 · 금액)도 바뀌지 않는다.
-- 시설이 아직 없는 새 DB에서는 아무 행도 바뀌지 않고, seed가 FACILITY_SEEDS로 네 시설을 만든다.

UPDATE facilities SET price = 77000 WHERE name = '수영장';
UPDATE facilities SET price = 80000 WHERE name = '라운지';

INSERT INTO facilities (hotel_id, name, price)
SELECT adult.hotel_id, child.name, child.price
FROM facilities adult
JOIN (
  SELECT '수영장' AS adult_name, '수영장 소인' AS name, 44000 AS price
  UNION ALL
  SELECT '라운지', '라운지 소인', 30000
) child ON child.adult_name = adult.name
WHERE NOT EXISTS (
  SELECT 1 FROM facilities existing
  WHERE existing.hotel_id = adult.hotel_id AND existing.name = child.name
);
