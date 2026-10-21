-- 결제 DB 기준선: 2차 프로젝트에서 TypeORM synchronize가 만들던 payments 테이블 구조 그대로입니다.
-- (2026-10-13 기준 SHOW CREATE TABLE 결과와 동일)
--
-- ERD 위키의 결제 DB V1에는 "메인 DB에서 데이터 이전"도 있지만, 결제 DB를 처음 만드는 시점에
-- 결제 데이터가 쌓인 환경(로컬/온프레미스 dev/AWS)이 없어서 이전 단계는 생략합니다.
-- 혹시 기존 결제 데이터가 있는 DB를 옮겨야 하면, V2 실행 전에 이 테이블에 그대로 INSERT 하면
-- V2가 상태값(paid/refunded)까지 새 형식으로 변환합니다.
CREATE TABLE payments (
  paymentId INT NOT NULL AUTO_INCREMENT,
  reservation_id INT NOT NULL,
  user_id INT NOT NULL,
  approval_number VARCHAR(255) NOT NULL,
  payment_key VARCHAR(255) NOT NULL,
  amount INT NOT NULL,
  payment_method VARCHAR(255) NOT NULL,
  status ENUM('paid', 'refunded') NOT NULL DEFAULT 'paid',
  paid_at DATETIME NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (paymentId)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
