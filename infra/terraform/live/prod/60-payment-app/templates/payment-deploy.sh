#!/bin/bash
# 결제 서버 pull agent (LDP-116). user-data 가 /usr/local/bin/payment-deploy 로 설치한다.
#
#   payment-deploy --boot   부팅 때 user-data 가 1회 실행 (시차 · Standby 없이 바로 배포)
#   payment-deploy          systemd timer(payment-deploy.timer) 가 1분마다 실행
#
# Parameter Store 의 release({image_tag, env}) 가 현재 적용값과 다르면 배포한다.
#   ECR pull → Flyway(payment-migrations, 같은 태그) → ASG Standby(NLB drain) → payment-service 교체 → 헬스 확인 → Standby 해제
#   헬스 확인에 실패하면 이전 release 로 되돌리고, 실패한 release 는 값이 바뀔 때까지 다시 시도하지 않는다.
#   ECR · Secrets Manager 조회 실패 같은 일시 오류는 실패로 기록하지 않고 다음 주기에 다시 시도한다.
#
# 2대 이상일 때 동시에 빠지지 않도록, 첫 AZ 가 아닌 서버는 release 를 처음 본 뒤 STAGGER_SECONDS × (AZ 순번) 만큼 기다리고,
# 다른 인스턴스가 Standby 중이면 다음 주기로 미룬다.
#
# 비밀값(결제 DB · 토스 시크릿 키)은 /run(tmpfs) 의 0600 파일로만 컨테이너에 넘기고 실행 후 지운다. 로그에 찍지 않는다.
# 설정 값은 /etc/payment-deploy/config.env (Terraform 60-payment-app user-data 가 만든다).
#
# 배포 이벤트는 CloudWatch Logs(DEPLOY_LOG_GROUP)에 JSON 한 줄로 남긴다. 90-observability-alarms 지표 필터가 이 형식을 읽는다.
#   {event, image_tag, provider, detail, instance, az, mode}
#   event     deploy_start · deploy_success · deploy_retry · deploy_failed · invalid_release · rollback_success · rollback_failed · rollback_skipped
#   provider  release env 의 PAYMENT_PROVIDER (TOSS · MOCK, 롤백이면 되돌린 release 의 값)
# 릴리스 배포(이미 배포된 서버의 갱신, timer)의 결과 이벤트(시작 · 재시도 제외)는 배포 토픽(DEPLOY_TOPIC_NAME → Slack #deploy)에도
# 발행한다 (44 sns 엔드포인트). 부팅 배포(매일 재생성 · ASG 교체)는 발행하지 않는다 — 부팅 실패는 deploy-failed 알람(#alerts)이 알린다.
set -Eeuo pipefail

# shellcheck source=/dev/null
source /etc/payment-deploy/config.env

STATE_DIR=/var/lib/payment-deploy
RUN_DIR=/run/payment-deploy
APP_CONTAINER=payment-service

MODE=timer
if [[ "${1:-}" == "--boot" ]]; then
  MODE=boot
fi

mkdir -p "$STATE_DIR" "$RUN_DIR"
chmod 0700 "$STATE_DIR" "$RUN_DIR"

# 부팅 실행과 timer 실행이 겹치지 않게 한다 (timer 는 부팅 실행 뒤에 켜지지만 수동 실행 대비)
exec 9>"$RUN_DIR/lock"
if ! flock -n 9; then
  echo "다른 배포가 진행 중이라 건너뜁니다"
  exit 0
fi

# ── 공통 ──────────────────────────────────────────────

imds() {
  local token
  token=$(curl -sf -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  curl -sf -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/$1"
}

INSTANCE_ID=$(imds meta-data/instance-id)
AZ=$(imds meta-data/placement/availability-zone)
ACCOUNT_ID=$(imds dynamic/instance-identity/document | jq -r .accountId)
REGISTRY="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
QUEUE_URL="https://sqs.$REGION.amazonaws.com/$ACCOUNT_ID/$PAYMENT_RESULT_QUEUE_NAME"
DEPLOY_TOPIC_ARN="arn:aws:sns:$REGION:$ACCOUNT_ID:$DEPLOY_TOPIC_NAME"
PROVIDER=""

log() {
  echo "[payment-deploy] $*"
}

# 배포 이벤트를 CloudWatch Logs 에도 남긴다 (실패해도 배포는 계속)
event() {
  local name=$1 detail=${2:-} message
  log "$name ${detail}"
  message=$(jq -cn --arg event "$name" --arg detail "$detail" --arg tag "${TARGET_TAG:-}" --arg provider "$PROVIDER" \
    --arg instance "$INSTANCE_ID" --arg az "$AZ" --arg mode "$MODE" \
    '{event: $event, image_tag: $tag, provider: $provider, detail: $detail, instance: $instance, az: $az, mode: $mode}')
  aws logs create-log-stream --region "$REGION" --log-group-name "$DEPLOY_LOG_GROUP" \
    --log-stream-name "$INSTANCE_ID" >/dev/null 2>&1 || true
  aws logs put-log-events --region "$REGION" --log-group-name "$DEPLOY_LOG_GROUP" --log-stream-name "$INSTANCE_ID" \
    --log-events "$(jq -cn --arg m "$message" --argjson t "$(date +%s%3N)" '[{timestamp: $t, message: $m}]')" \
    >/dev/null 2>&1 || log "CloudWatch Logs 기록 실패 (계속 진행)"
  notify "$name" "$detail"
}

# 배포 결과를 Slack #deploy 로 (AWS Chatbot 사용자 정의 알림 형식). 실패해도 배포는 계속
notify() {
  local name=$1 detail=$2 title
  if [[ "$MODE" != "timer" || -z "${CURRENT:-}" ]]; then
    return 0
  fi
  case "$name" in
    deploy_success) title=":white_check_mark: 결제 서버 배포 성공" ;;
    deploy_failed) title=":x: 결제 서버 배포 실패" ;;
    invalid_release) title=":x: 결제 서버 release 형식 오류" ;;
    rollback_success) title=":leftwards_arrow_with_hook: 결제 서버 이전 release 로 롤백" ;;
    rollback_failed) title=":rotating_light: 결제 서버 롤백 실패" ;;
    rollback_skipped) title=":warning: 결제 서버 롤백 불가 (이전 release 없음)" ;;
    *) return 0 ;;
  esac
  aws sns publish --region "$REGION" --topic-arn "$DEPLOY_TOPIC_ARN" --message "$(
    jq -cn --arg title "$title" --arg event "$name" --arg detail "$detail" --arg tag "${TARGET_TAG:-}" \
      --arg provider "${PROVIDER:-?}" --arg instance "$INSTANCE_ID" --arg az "$AZ" --arg mode "$MODE" '
      {version: "1.0", source: "custom",
       content: {
         textType: "client-markdown",
         title: $title,
         description: ("*릴리스* `\($tag[0:8])`\n*인스턴스* `\($instance)` (\($az), \($mode))\n*PG* `\($provider)`"
                       + (if $detail == "" then "" else "\n\($detail)" end))},
       metadata: {summary: $title, eventType: $event,
                  additionalContext: {release: $tag, instance: $instance}}}')" \
    >/dev/null 2>&1 || log "배포 알림 발행 실패 (계속 진행)"
}

sha() {
  sha256sum | cut -d' ' -f1
}

# ── release 검증 ─────────────────────────────────────────
# env 는 비밀이 아닌 설정만 받는다. 인프라가 넣는 값(DB · 비밀값 · 큐 · 자격 증명 · 포트)은 gitops 로 덮어쓸 수 없다
RESERVED_ENV_REGEX='^(PAYMENT_DB_.*|TOSS_SECRET_KEY|SQS_.*|PAYMENT_RESULT_QUEUE_URL|PG_MOCK_SERVICE_URL|AWS_.*|HEALTH_PORT|METRICS_PORT)$'

validate_release() {
  jq -e --arg reserved "$RESERVED_ENV_REGEX" '
    (.image_tag | type == "string" and test("^[0-9a-f]{7,40}$"))
    and ((.env // {}) | type == "object")
    and ([(.env // {}) | to_entries[]
          | (.key | test("^[A-Z][A-Z0-9_]*$")) and ((.key | test($reserved)) | not)
            and (.value | type == "string") and ((.value | test("[\r\n]")) | not)]
         | all)
  ' >/dev/null 2>&1 <<<"$1"
}

# ── ASG Standby ─────────────────────────────────────────
IN_STANDBY=0

lifecycle_state() {
  aws autoscaling describe-auto-scaling-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
    --query 'AutoScalingInstances[0].LifecycleState' --output text
}

wait_lifecycle() {
  local want=$1 i state
  for ((i = 0; i < STANDBY_TIMEOUT; i += 5)); do
    state=$(lifecycle_state)
    if [[ "$state" == "$want" ]]; then
      return 0
    fi
    sleep 5
  done
  log "LifecycleState 가 ${STANDBY_TIMEOUT}초 안에 $want 가 되지 않았습니다 (현재 $state)"
  return 1
}

# 희망 대수를 1 줄여 Standby 로 보낸다 (ASG 가 대신할 인스턴스를 띄우지 않음). NLB 에서 빠지고 진행 중 연결은 drain 된다.
# 1대뿐이면 최소 대수 아래로 내려갈 수 없어 Standby 없이 교체한다 (교체 동안 결제 중단)
enter_standby() {
  local asg desired min
  asg=$(aws autoscaling describe-auto-scaling-groups --region "$REGION" --auto-scaling-group-names "$ASG_NAME" \
    --query 'AutoScalingGroups[0].[DesiredCapacity, MinSize]' --output text)
  read -r desired min <<<"$asg"
  if ((desired - 1 < min)); then
    log "희망 대수 $desired, 최소 대수 $min 이라 Standby 없이 교체합니다 (교체 동안 이 서버로 가는 요청 실패)"
    return 0
  fi
  aws autoscaling enter-standby --region "$REGION" --auto-scaling-group-name "$ASG_NAME" \
    --instance-ids "$INSTANCE_ID" --should-decrement-desired-capacity >/dev/null
  IN_STANDBY=1
  wait_lifecycle Standby
}

exit_standby() {
  if ((IN_STANDBY == 0)); then
    return 0
  fi
  aws autoscaling exit-standby --region "$REGION" --auto-scaling-group-name "$ASG_NAME" \
    --instance-ids "$INSTANCE_ID" >/dev/null
  IN_STANDBY=0
  wait_lifecycle InService
}

# 다른 인스턴스가 InService 가 아니면(Standby 로 배포 중, 부팅 중, 종료 중) true. 그때 빠지면 받을 서버가 없을 수 있다
others_not_in_service() {
  local count
  count=$(aws autoscaling describe-auto-scaling-groups --region "$REGION" --auto-scaling-group-names "$ASG_NAME" \
    --query "length(AutoScalingGroups[0].Instances[?InstanceId != '$INSTANCE_ID' && LifecycleState != 'InService'])" \
    --output text)
  ((count > 0))
}

# 어느 단계에서 중단되든 Standby 에 남기지 않는다. 서비스가 비정상이면 NLB 헬스체크로 ASG 가 교체한다
trap 'exit_standby || log "Standby 해제 실패"' EXIT

# ── 이미지 · 설정 ────────────────────────────────────────

ecr_login() {
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
}

# 성공 0, 이미지 없음(존재하지 않는 태그) 2, 그 밖의 오류 1
pull() {
  local image=$1 out
  if out=$(docker pull --quiet "$image" 2>&1); then
    return 0
  fi
  log "pull 실패: ${image#"$REGISTRY/"}: ${out//$REGISTRY\//}"
  if grep -qiE 'not found|manifest unknown' <<<"$out"; then
    return 2
  fi
  return 1
}

# payment.env · flyway.env 를 만든다. 비밀값은 파일로만 쓴다
render_env() {
  local release=$1 db provider toss
  umask 077
  db=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$PAYMENT_DB_SECRET_ID" \
    --query SecretString --output text)
  provider=$(jq -r '.env.PAYMENT_PROVIDER // ""' <<<"$release")

  {
    echo "NODE_ENV=production"
    jq -r '"PAYMENT_DB_HOST=\(.host)", "PAYMENT_DB_PORT=\(.port)", "PAYMENT_DB_USERNAME=\(.username)",
           "PAYMENT_DB_PASSWORD=\(.password)", "PAYMENT_DB_DATABASE=\(.dbname)"' <<<"$db"
    echo "PAYMENT_DB_SSL=true"
    echo "PAYMENT_DB_SSL_CA_PATH=$RDS_CA_PATH"
    echo "SQS_REGION=$REGION"
    echo "PAYMENT_RESULT_QUEUE_URL=$QUEUE_URL"
    echo "PG_MOCK_SERVICE_URL=$PG_MOCK_SERVICE_URL"
    echo "HEALTH_PORT=$HEALTH_PORT"
    # GET /metrics — 같은 서버의 Alloy(payment-metrics)가 127.0.0.1 로 읽는다 (LDP-181)
    echo "METRICS_PORT=$METRICS_PORT"
    # MOCK 이면 토스 시크릿 키를 읽지 않는다
    if [[ "$provider" == "TOSS" ]]; then
      toss=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$TOSS_SECRET_ID" \
        --query SecretString --output text)
      jq -r '"TOSS_SECRET_KEY=\(.secret_key)"' <<<"$toss"
    fi
    # gitops 의 비밀 아닌 설정 (위 값과 겹치는 키는 validate_release 가 막는다. NODE_ENV 는 덮어쓸 수 있다)
    jq -r '(.env // {}) | to_entries[] | "\(.key)=\(.value)"' <<<"$release"
  } >"$RUN_DIR/payment.env"

  # RDS 는 TLS 만 허용한다 (require_secure_transport). Flyway 이미지의 드라이버는 MariaDB Connector/J 2.x 라
  # 3.x 옵션(sslMode)은 무시되고 평문으로 붙는다. 2.x 는 useSsl + serverSslCert 이고 호스트 이름 검증은 기본으로 켜져 있다.
  # 재시도는 짧게 둔다 (1+2+4+8+16초). 길면 부팅 배포가 ASG 헬스체크 유예 시간을 넘긴다
  jq -r --arg ca "$RDS_CA_PATH" '
    "FLYWAY_URL=jdbc:mariadb://\(.host):\(.port)/\(.dbname)?useSsl=true&serverSslCert=\($ca)",
    "FLYWAY_USER=\(.username)", "FLYWAY_PASSWORD=\(.password)", "FLYWAY_CONNECT_RETRIES=5"' <<<"$db" \
    >"$RUN_DIR/flyway.env"
}

clean_env() {
  rm -f "$RUN_DIR/payment.env" "$RUN_DIR/flyway.env"
}

# ── 실행 · 헬스 ─────────────────────────────────────────

run_app() {
  local image=$1
  docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
  # host 네트워크: IMDS hop limit 1 그대로 인스턴스 Role 을 쓰고(SQS), NLB 가 인스턴스 포트로 바로 들어온다
  docker run -d --name "$APP_CONTAINER" --network host --restart unless-stopped \
    --env-file "$RUN_DIR/payment.env" \
    -v "$RDS_CA_PATH:$RDS_CA_PATH:ro" \
    --log-driver awslogs \
    --log-opt awslogs-region="$REGION" \
    --log-opt awslogs-group="$APP_LOG_GROUP" \
    --log-opt awslogs-stream="$INSTANCE_ID/$APP_CONTAINER" \
    --log-opt mode=non-blocking \
    "$image" >/dev/null
}

# /health 와 gRPC 포트가 연속 3번 응답하면 정상. 재시작을 반복하는 컨테이너는 걸러진다
wait_healthy() {
  local ok=0 i
  for ((i = 0; i < HEALTH_TIMEOUT; i += 3)); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null)" == "true" ]] &&
      curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$HEALTH_PORT/health" &&
      [[ -n "$(ss -Htln "sport = :$GRPC_PORT")" ]]; then
      ok=$((ok + 1))
      if ((ok >= 3)); then
        return 0
      fi
    else
      ok=0
    fi
    sleep 3
  done
  log "payment-service 가 ${HEALTH_TIMEOUT}초 안에 정상이 되지 않았습니다. 마지막 로그:"
  docker logs --tail 30 "$APP_CONTAINER" 2>&1 | grep -viE 'password|secret' || true
  return 1
}

# 현재 · 이전 release 이미지만 남긴다 (롤백은 이전 이미지를 다시 받지 않는다)
prune_images() {
  local keep=() tag image
  for f in current previous; do
    if [[ -f "$STATE_DIR/$f.json" ]]; then
      keep+=("$(jq -r .image_tag "$STATE_DIR/$f.json")")
    fi
  done
  docker images --format '{{.Repository}}:{{.Tag}}' |
    grep -E "^$REGISTRY/($APP_REPOSITORY|$MIGRATIONS_REPOSITORY):" |
    while read -r image; do
      tag=${image##*:}
      if [[ ! " ${keep[*]} " == *" $tag "* ]]; then
        docker rmi "$image" >/dev/null 2>&1 || true
      fi
    done
}

# ── 배포 ──────────────────────────────────────────────

RAW_RELEASE=$(aws ssm get-parameter --region "$REGION" --name "$RELEASE_PARAMETER" --query Parameter.Value --output text)
# 키 순서 · 공백이 달라도 같은 release 로 본다. JSON 이 아니면 원문 그대로 두고 아래 검증에서 실패시킨다
RELEASE=$(jq -cS . <<<"$RAW_RELEASE" 2>/dev/null) || RELEASE=$RAW_RELEASE
HASH=$(sha <<<"$RELEASE")

CURRENT=""
if [[ -f "$STATE_DIR/current.json" ]]; then
  CURRENT=$(cat "$STATE_DIR/current.json")
fi

if [[ "$RELEASE" == "$CURRENT" ]]; then
  exit 0
fi

if [[ -f "$STATE_DIR/failed" && "$(cat "$STATE_DIR/failed")" == "$HASH" ]]; then
  exit 0
fi

# 11-registry 가 만든 첫 값(image_tag = none) 이면 아직 배포할 것이 없다
TARGET_TAG=$(jq -r '.image_tag // ""' <<<"$RELEASE" 2>/dev/null || true)
if [[ "$TARGET_TAG" == "none" ]]; then
  log "release 가 아직 없습니다 ($RELEASE_PARAMETER image_tag = none)"
  exit 0
fi

PROVIDER=$(jq -r '.env.PAYMENT_PROVIDER // ""' <<<"$RELEASE" 2>/dev/null || true)

if ! validate_release "$RELEASE"; then
  echo "$HASH" >"$STATE_DIR/failed"
  event invalid_release "image_tag 는 커밋 SHA, env 는 문자열 값의 객체여야 하고 인프라 소유 키($RESERVED_ENV_REGEX)는 쓸 수 없습니다"
  exit 1
fi

# 이미 배포된 서버의 갱신(timer)만 시차를 둔다. 부팅 · 첫 배포는 바로 한다
if [[ "$MODE" == "timer" && -n "$CURRENT" ]]; then
  # AZ_ORDER 는 AZ 접미사 목록(a b)
  read -r -a azs <<<"$AZ_ORDER"
  index=0
  for i in "${!azs[@]}"; do
    if [[ "${azs[$i]}" == "${AZ: -1}" ]]; then
      index=$i
    fi
  done
  delay=$((index * STAGGER_SECONDS))
  now=$(date +%s)
  if [[ ! -f "$STATE_DIR/pending" || "$(cut -d' ' -f1 "$STATE_DIR/pending")" != "$HASH" ]]; then
    echo "$HASH $now" >"$STATE_DIR/pending"
  fi
  first_seen=$(cut -d' ' -f2 "$STATE_DIR/pending")
  if ((now - first_seen < delay)); then
    log "AZ 시차 대기 ($AZ, $((delay - (now - first_seen)))초 남음)"
    exit 0
  fi
  if others_not_in_service; then
    log "다른 결제 서버가 InService 가 아니라(배포 · 부팅 · 종료 중) 다음 주기로 미룹니다"
    exit 0
  fi
fi

event deploy_start "$(jq -c '.env // {}' <<<"$RELEASE")"

APP_IMAGE="$REGISTRY/$APP_REPOSITORY:$TARGET_TAG"
MIGRATIONS_IMAGE="$REGISTRY/$MIGRATIONS_REPOSITORY:$TARGET_TAG"

ecr_login
for image in "$APP_IMAGE" "$MIGRATIONS_IMAGE"; do
  rc=0
  pull "$image" || rc=$?
  if ((rc == 2)); then
    echo "$HASH" >"$STATE_DIR/failed"
    event deploy_failed "이미지가 없습니다: ${image#"$REGISTRY/"}"
    exit 1
  elif ((rc != 0)); then
    event deploy_retry "pull 일시 오류, 다음 주기에 다시 시도"
    exit 1
  fi
done

trap 'clean_env; exit_standby || log "Standby 해제 실패"' EXIT
render_env "$RELEASE"

# 앱을 바꾸기 전에 마이그레이션한다. 여러 서버가 동시에 실행해도 Flyway 가 DB 잠금으로 순서대로 처리한다.
# 실행 중인 이전 버전과 함께 동작해야 하므로 마이그레이션은 추가만 한다 (삭제는 두 릴리스에 나눠서)
if ! docker run --rm --network host --env-file "$RUN_DIR/flyway.env" \
  -v "$RDS_CA_PATH:$RDS_CA_PATH:ro" "$MIGRATIONS_IMAGE" migrate; then
  echo "$HASH" >"$STATE_DIR/failed"
  event deploy_failed "Flyway migrate 실패 — payment-service 는 바꾸지 않았습니다"
  exit 1
fi

if [[ "$MODE" == "timer" && -n "$CURRENT" ]]; then
  enter_standby
fi

run_app "$APP_IMAGE"
if wait_healthy; then
  if [[ -n "$CURRENT" ]]; then
    echo "$CURRENT" >"$STATE_DIR/previous.json"
  fi
  echo "$RELEASE" >"$STATE_DIR/current.json"
  rm -f "$STATE_DIR/pending"
  clean_env
  exit_standby
  event deploy_success
  prune_images
  exit 0
fi

echo "$HASH" >"$STATE_DIR/failed"
event deploy_failed "헬스 확인 실패"

if [[ -z "$CURRENT" ]]; then
  event rollback_skipped "이전 release 가 없습니다 (부팅 · 첫 배포). NLB 헬스체크 실패로 ASG 가 교체합니다"
  exit 1
fi

# 이전 release 로 되돌린다 (이미지는 남아 있고, 비밀값은 다시 읽는다)
TARGET_TAG=$(jq -r .image_tag <<<"$CURRENT")
PROVIDER=$(jq -r '.env.PAYMENT_PROVIDER // ""' <<<"$CURRENT")
render_env "$CURRENT"
run_app "$REGISTRY/$APP_REPOSITORY:$TARGET_TAG"
if wait_healthy; then
  event rollback_success
else
  event rollback_failed "이전 release 도 정상이 아닙니다"
fi
exit 1
