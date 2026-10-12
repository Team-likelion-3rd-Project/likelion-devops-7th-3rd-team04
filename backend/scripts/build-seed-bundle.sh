#!/usr/bin/env bash
# DEV-102: infra/terraform/modules/database의 mariadb user_data가 부팅 시 내려받아 실행할
# 시딩 번들을 만들어 S3에 올린다.
#
# 왜 필요한가: scripts/seed.ts는 네이티브 바인딩이 있는 bcrypt 패키지를 쓰기 때문에
# esbuild 등으로 파일 하나에 번들링할 수 없다 — 실제로 npm ci를 돌려서 만든 진짜
# node_modules를 그대로 가져가야 한다. mariadb EC2(Amazon Linux 2023, x86_64/glibc)가
# 실행할 것이므로, 같은 glibc/아키텍처 환경(amazonlinux:2023 컨테이너)에서 빌드해야
# 네이티브 바인딩이 실제 실행 환경과 호환된다. 이 EC2는 private_data 서브넷이라
# 인터넷/NAT가 없고 S3 Gateway VPC Endpoint만 열려 있어, 산출물은 S3를 거쳐서만
# 전달할 수 있다 (infra/terraform/modules/database/main.tf 참고).
#
# 사용법:
#   cd backend
#   ./scripts/build-seed-bundle.sh <S3_BUCKET> [S3_KEY]
#   # S3_KEY 기본값: seed/seed-bundle.tar.gz
#   # (환경변수 AWS_PROFILE 등으로 자격 증명 지정 가능 — aws s3 cp 그대로 사용)
#
# 시딩 데이터(관리자 계정/호텔/객실)를 바꿨다면 이 스크립트를 다시 실행해 번들을
# 갱신하고, terraform.tfvars의 seed_admin_* 값도 같이 바뀌었다면 다음 apply에서
# mariadb가 재생성되며 새 데이터로 다시 시딩된다.

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "usage: $0 <S3_BUCKET> [S3_KEY]" >&2
  exit 1
fi

S3_BUCKET="$1"
S3_KEY="${2:-seed/seed-bundle.tar.gz}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_PATH="$SCRIPT_DIR/seed-bundle.tar.gz"

echo "[build-seed-bundle] amazonlinux:2023 컨테이너에서 npm ci 실행 (네이티브 bcrypt 바인딩을 mariadb EC2와 동일한 glibc/아키텍처로 빌드)..."
docker run --rm -v "$BACKEND_DIR":/app -w /app amazonlinux:2023 bash -c "
  set -e
  dnf install -y nodejs20 tar gzip >/dev/null
  npm ci
"

echo "[build-seed-bundle] 번들 아카이브 생성..."
tar czf "$BUNDLE_PATH" -C "$BACKEND_DIR" \
  node_modules \
  scripts/seed.ts \
  apps/hotel-service/src/entities \
  apps/user-service/src/admin/entities \
  apps/auth-service/src/entities \
  tsconfig.json \
  tsconfig.build.json \
  package.json

echo "[build-seed-bundle] s3://$S3_BUCKET/$S3_KEY 로 업로드..."
aws s3 cp "$BUNDLE_PATH" "s3://$S3_BUCKET/$S3_KEY"

rm -f "$BUNDLE_PATH"
echo "[build-seed-bundle] 완료. terraform.tfvars의 seed_bundle_s3_uri가 s3://$S3_BUCKET/$S3_KEY 를 가리키는지 확인하세요."
