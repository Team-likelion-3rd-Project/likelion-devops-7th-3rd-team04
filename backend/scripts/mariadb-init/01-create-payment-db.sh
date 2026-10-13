#!/bin/bash
# 로컬 docker compose 전용: mariadb 컨테이너가 "처음 초기화될 때" 결제 DB와 결제 전용 계정을 만듭니다.
# (mariadb 공식 이미지는 MARIADB_DATABASE/MARIADB_USER로 DB·계정을 하나만 만들어 주기 때문에,
#  두 번째 DB인 결제 DB는 이 스크립트로 만듭니다. 테이블은 payment-db-migration(Flyway)이 만듭니다.)
#
# - docker-compose.yml에서 /docker-entrypoint-initdb.d 로 마운트되며, 이미지 엔트리포인트가 실행합니다.
# - 실행 권한 없이 두면 엔트리포인트가 source 해서 docker_process_sql 함수를 쓸 수 있습니다.
# - 값은 .env의 PAYMENT_DB_* 를 씁니다 (mariadb 서비스의 env_file로 들어옴).
# - 온프레미스 dev / AWS의 결제 DB·계정은 이 스크립트가 아니라 각 인프라 코드(Ansible / Terraform)가 만듭니다.
set -eu

: "${PAYMENT_DB_DATABASE:?.env에 PAYMENT_DB_DATABASE가 없습니다 (.env.example 참고)}"
: "${PAYMENT_DB_USERNAME:?.env에 PAYMENT_DB_USERNAME이 없습니다 (.env.example 참고)}"
: "${PAYMENT_DB_PASSWORD:?.env에 PAYMENT_DB_PASSWORD가 없습니다 (.env.example 참고)}"

docker_process_sql --database=mysql <<-EOSQL
	CREATE DATABASE IF NOT EXISTS \`${PAYMENT_DB_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
	CREATE USER IF NOT EXISTS '${PAYMENT_DB_USERNAME}'@'%' IDENTIFIED BY '${PAYMENT_DB_PASSWORD}';
	GRANT ALL PRIVILEGES ON \`${PAYMENT_DB_DATABASE}\`.* TO '${PAYMENT_DB_USERNAME}'@'%';
EOSQL
