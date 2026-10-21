#!/bin/bash
# 로컬 docker compose 전용: mariadb 컨테이너가 "처음 초기화될 때" 결제 DB와 결제 전용 계정을 만듭니다.
# (mariadb 공식 이미지는 MARIADB_DATABASE/MARIADB_USER로 DB·계정을 하나만 만들어 주기 때문에,
#  두 번째 DB인 결제 DB는 이 스크립트로 만듭니다. 테이블은 payment-db-migration(Flyway)이 만듭니다.)
#
# - docker-compose.yml에서 /docker-entrypoint-initdb.d 로 마운트되며, 이미지 엔트리포인트가 실행합니다.
# - 엔트리포인트는 실행 권한이 없으면 source, 있으면 실행합니다. Windows 경로(/mnt/c)에서 체크아웃하면
#   모든 파일에 실행 권한이 붙어 보이므로, 어느 쪽이든 동작하도록 엔트리포인트 전용 함수
#   (docker_process_sql) 대신 mariadb 클라이언트를 직접 호출합니다 (LDP-60).
#   source될 때 엔트리포인트의 셸 옵션을 바꾸지 않도록 set -e/-u 도 쓰지 않습니다.
# - 줄바꿈은 LF여야 합니다 (CRLF면 bash가 실행하지 못함) — backend/.gitattributes 가 고정합니다.
# - 값은 .env의 PAYMENT_DB_* 를 씁니다 (mariadb 서비스의 env_file로 들어옴).
# - 온프레미스 dev / AWS의 결제 DB·계정은 이 스크립트가 아니라 각 인프라 코드(Ansible / Terraform)가 만듭니다.

for var in PAYMENT_DB_DATABASE PAYMENT_DB_USERNAME PAYMENT_DB_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "[01-create-payment-db] .env에 ${var}가 없습니다 (.env.example 참고)" >&2
    exit 1
  fi
done

# 초기화 단계의 임시 서버는 네트워크 없이 소켓으로만 열려 있고, root 비밀번호는 이미 설정된 상태입니다.
# set -e 를 안 쓰므로 실패는 직접 확인해서 컨테이너 초기화를 멈춥니다.
if ! MYSQL_PWD="${MARIADB_ROOT_PASSWORD}" mariadb --protocol=socket -uroot <<EOSQL
CREATE DATABASE IF NOT EXISTS \`${PAYMENT_DB_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS '${PAYMENT_DB_USERNAME}'@'%' IDENTIFIED BY '${PAYMENT_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${PAYMENT_DB_DATABASE}\`.* TO '${PAYMENT_DB_USERNAME}'@'%';
EOSQL
then
  echo "[01-create-payment-db] 결제 DB/계정 생성 실패" >&2
  exit 1
fi
echo "[01-create-payment-db] 결제 DB(${PAYMENT_DB_DATABASE}) / 계정(${PAYMENT_DB_USERNAME}) 준비 완료"
