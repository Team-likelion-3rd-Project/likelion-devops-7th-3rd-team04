-- 소셜 로그인 연결 (LDP-194).
-- 카카오 등 외부 계정과 우리 회원(users.id)을 잇는다. 소셜로 가입한 회원은 credentials(비밀번호)가 없고 이 테이블에만 있다.
-- credentials와 같은 auth-service 소유라 컬럼 이름도 credentials처럼 camelCase로 둔다.
--   provider        KAKAO (이후 NAVER · GOOGLE)
--   providerUserId  외부 서비스의 회원 번호 (카카오 회원번호)
--   email           가입 당시 외부 계정 이메일 (없으면 NULL) — 기록용, 로그인 판단에는 쓰지 않는다
-- userId는 user-service의 users.id를 gRPC로 참조하므로 FK는 걸지 않는다 (credentials.userId와 같음, ERD 위키 FK 없는 참조).

CREATE TABLE social_accounts (
  id INT NOT NULL AUTO_INCREMENT,
  userId INT NOT NULL,
  provider VARCHAR(20) NOT NULL,
  providerUserId VARCHAR(100) NOT NULL,
  email VARCHAR(255) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  -- 같은 카카오 계정은 한 회원에게만 연결
  UNIQUE KEY uk_social_accounts_provider_user (provider, providerUserId),
  -- 한 회원은 provider마다 하나만 연결
  UNIQUE KEY uk_social_accounts_user_provider (userId, provider)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
