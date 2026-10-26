#!/bin/sh
# 마이그레이션 이미지 진입점 — 메인(backend/migrations) · 결제(apps/payment-service/migrations) 공통.
# 결제 쪽 파일은 이 파일의 사본입니다 (빌드 컨텍스트가 달라서). 원본만 고치고 복사하세요 — CI helm-lint 가 두 파일을 비교합니다.
#
#   migrate [flyway 옵션...] : flyway migrate. MIGRATE_RESET_ON_DOWNGRADE=true 이면 DB 를 이 이미지 버전에 맞춤 (아래)
#   그 밖의 인자             : 그대로 flyway 에 넘김 (info, validate 등)
#
# MIGRATE_RESET_ON_DOWNGRADE=true (dev 전용 — 차트 migrations.<이름>.resetOnDowngrade, 결제 노드 flyway.env)
#   DB 에는 적용됐는데 이 이미지에 없는 버전(Flyway state Future / Missing)이 있으면 = 이전 버전으로 롤백한 것으로 보고
#   flyway clean(이 DB 의 모든 객체 삭제) 후 이 이미지의 V1 ~ 최고 버전을 다시 적용합니다. 데이터는 차트의 seed Job 이 다시 채웁니다.
#   운영은 이 값을 켜지 않습니다 — 이전 release 로 되돌려도 DB 는 그대로 (마이그레이션은 추가만).
set -eu

if [ "${1:-}" != "migrate" ]; then
  exec flyway "$@"
fi
shift

if [ "${MIGRATE_RESET_ON_DOWNGRADE:-false}" != "true" ]; then
  exec flyway migrate "$@"
fi

# 이 이미지의 최고 버전 (V<버전>__*.sql)
image_max=$(ls /flyway/sql | sed -n 's/^V\([0-9][0-9.]*\)__.*\.sql$/\1/p' | sort -t. -k1,1n -k2,2n | tail -n 1)

# DB 에만 있는 버전 — Future(이미지 최고 버전보다 높음) / Missing(이미지에 없음). 상태 이름은 "Future", "Failed (Future)" 등
info=$(flyway info -outputType=json "$@")
db_only=$(printf '%s' "$info" | jq -r '[.migrations[] | select(.category == "Versioned" and (.state | test("Future|Missing"))) | .version] | join(" ")')

if [ -n "$db_only" ]; then
  echo "[migrate] downgrade: DB 에만 있는 버전 ${db_only} — 이미지 최고 버전 V${image_max}"
  echo "[migrate] flyway clean 후 V${image_max} 까지 다시 적용합니다 (이 DB 의 데이터는 모두 지워짐, 시딩이 다시 채움)"
  flyway clean -cleanDisabled=false "$@"
fi

exec flyway migrate "$@"
