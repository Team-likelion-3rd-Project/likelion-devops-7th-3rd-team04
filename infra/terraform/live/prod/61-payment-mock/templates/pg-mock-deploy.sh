#!/bin/bash
# pg-mock pull agent (LDP-116). user-data 가 /usr/local/bin/pg-mock-deploy 로 설치하고 systemd timer 가 1분마다 실행한다.
#
# 결제 서버와 같은 release 파라미터({image_tag, env})의 image_tag 로 pg-mock-service 를 띄운다 (릴리스는 모든 서비스를 같은 SHA 로 빌드).
# env 는 결제 서버 설정이라 쓰지 않는다. 비밀값 · DB 가 없어 Flyway · 롤백 외 절차가 없다.
#   이미지가 없거나 헬스 확인(GET /api-docs)에 실패하면 이전 태그로 되돌리고, 실패한 태그는 값이 바뀔 때까지 다시 시도하지 않는다.
# 설정 값은 /etc/pg-mock-deploy/config.env (Terraform 61-payment-mock user-data 가 만든다).
set -Eeuo pipefail

# shellcheck source=/dev/null
source /etc/pg-mock-deploy/config.env

STATE_DIR=/var/lib/pg-mock-deploy
CONTAINER=pg-mock-service

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
if ! flock -n 9; then
  echo "다른 배포가 진행 중이라 건너뜁니다"
  exit 0
fi

log() {
  echo "[pg-mock-deploy] $*"
}

imds() {
  local token
  token=$(curl -sf -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  curl -sf -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/$1"
}

ACCOUNT_ID=$(imds dynamic/instance-identity/document | jq -r .accountId)
REGISTRY="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

TAG=$(aws ssm get-parameter --region "$REGION" --name "$RELEASE_PARAMETER" --query Parameter.Value --output text |
  jq -r '.image_tag // ""' 2>/dev/null || true)
CURRENT=$(cat "$STATE_DIR/current" 2>/dev/null || true)

if [[ "$TAG" == "$CURRENT" || "$TAG" == "none" || "$TAG" == "$(cat "$STATE_DIR/failed" 2>/dev/null || true)" ]]; then
  exit 0
fi
if [[ ! "$TAG" =~ ^[0-9a-f]{7,40}$ ]]; then
  log "image_tag 가 커밋 SHA 가 아닙니다: $TAG"
  echo "$TAG" >"$STATE_DIR/failed"
  exit 1
fi

run() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  # 웹훅(PAYMENT_SERVICE_WEBHOOK_URL)은 쓰지 않는다 (결제 서버는 승인 API 응답으로 결과를 받음)
  docker run -d --name "$CONTAINER" --network host --restart unless-stopped \
    -e PORT="$MOCK_PORT" -e NODE_ENV=production "$REGISTRY/$REPOSITORY:$1" >/dev/null
}

wait_healthy() {
  local i
  for ((i = 0; i < HEALTH_TIMEOUT; i += 3)); do
    if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$MOCK_PORT/api-docs"; then
      return 0
    fi
    sleep 3
  done
  docker logs --tail 30 "$CONTAINER" 2>&1 || true
  return 1
}

log "배포 시작: $TAG (현재 ${CURRENT:-없음})"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
if ! out=$(docker pull --quiet "$REGISTRY/$REPOSITORY:$TAG" 2>&1); then
  log "pull 실패: $out"
  # 이미지가 없으면 실패로 기록하고, 그 밖의 오류는 다음 주기에 다시 시도한다
  if grep -qiE 'not found|manifest unknown' <<<"$out"; then
    echo "$TAG" >"$STATE_DIR/failed"
  fi
  exit 1
fi

run "$TAG"
if wait_healthy; then
  echo "$TAG" >"$STATE_DIR/current"
  log "배포 완료: $TAG"
  # 현재 · 직전 태그만 남긴다
  docker images --format '{{.Repository}}:{{.Tag}}' | grep "^$REGISTRY/$REPOSITORY:" |
    grep -vE ":($TAG|${CURRENT:-none})$" | xargs -r docker rmi >/dev/null 2>&1 || true
  exit 0
fi

echo "$TAG" >"$STATE_DIR/failed"
log "헬스 확인 실패: $TAG"
if [[ -n "$CURRENT" ]]; then
  run "$CURRENT"
  if wait_healthy; then
    log "롤백 완료: $CURRENT"
  else
    log "롤백 실패: $CURRENT"
  fi
fi
exit 1
