#!/bin/bash
# 결제 서버 지표 수집기 (LDP-181). user-data 가 /usr/local/bin/payment-metrics 로 설치하고 payment-metrics.service 가 실행한다.
#
#   1. Alloy 이미지 pull (11-registry 미러, digest 고정)
#   2. 결제 DB exporter 계정 생성 · 갱신 (master 로, 실행마다 비밀번호 · 제한 · 권한을 다시 넣음 — 재실행 안전)
#   3. Alloy 실행 (foreground — 끝나면 systemd 가 30초 뒤 다시 실행)
#
# 계정 단계가 실패해도 Alloy 는 띄운다 (서버 · 앱 지표는 계속 수집, 결제 DB 는 mysql_up 0 → AMP PaymentDbExporterDown 알림).
# 비밀번호는 명령 인자(ps 에 보임)가 아니라 0600 파일로만 넘긴다. 로그에 찍지 않는다.
# 설정 값은 /etc/payment-deploy/config.env · /etc/payment-metrics/config.env (Terraform 60-payment-app user-data 가 만든다).
set -Eeuo pipefail
umask 077

# shellcheck source=/dev/null
source /etc/payment-deploy/config.env
# shellcheck source=/dev/null
source /etc/payment-metrics/config.env

SECRETS_DIR=/etc/payment-metrics/secrets
RUN_DIR=/run/payment-metrics
CA_DIR=/etc/payment-metrics/rds-ca
mkdir -p "$SECRETS_DIR" "$RUN_DIR" "$CA_DIR" "$DATA_DIR"
chmod 0700 "$SECRETS_DIR" "$RUN_DIR" "$DATA_DIR"

log() {
  echo "[payment-metrics] $*"
}

imds() {
  local token
  token=$(curl -sf -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  curl -sf -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/$1"
}

INSTANCE_ID=$(imds meta-data/instance-id)
AZ=$(imds meta-data/placement/availability-zone)
ACCOUNT_ID=$(imds dynamic/instance-identity/document | jq -r .accountId)
REGISTRY="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
IMAGE="$REGISTRY/$ALLOY_REPOSITORY@$ALLOY_DIGEST"

# ── 1. 이미지 ─────────────────────────────────────────
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
  docker pull --quiet "$IMAGE" >/dev/null
fi

# ── 2. 결제 DB exporter 계정 ───────────────────────────
# Alloy(Go) 는 SSL_CERT_DIR 의 파일을 모두 신뢰 목록에 더한다 (기본 묶음 파일은 그대로). DSN 의 tls=true 가 호스트 이름까지 검증
install -m 0644 "$RDS_CA_PATH" "$CA_DIR/rds-ca-bundle.pem"

exporter=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$EXPORTER_SECRET_ID" \
  --query SecretString --output text)
jq -j '"\(.username):\(.password)@tcp(\(.host):\(.port))/?tls=true"' <<<"$exporter" >"$SECRETS_DIR/mysql.dsn"

setup_account() {
  local master
  master=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$PAYMENT_DB_SECRET_ID" \
    --query SecretString --output text) || return 1
  jq -r --arg ca "$RDS_CA_PATH" '"[client]", "host=\(.host)", "port=\(.port)", "user=\(.username)", "password=\(.password)",
    "ssl-ca=\($ca)", "ssl-verify-server-cert"' <<<"$master" >"$RUN_DIR/master.cnf"

  # 'exporter'@'%' — 두 결제 서버(app 서브넷) 가 접속. 접속 출처는 SG P3 가 결제 서버로 제한.
  # 권한은 메인(gitops mysql-exporter-setup account.sh) · 온프레미스 db_stack 과 같다
  # SQL 의 작은따옴표는 $q 로 넣는다 (jq 프로그램이 셸 작은따옴표 안에 있음). 비밀번호는 영숫자만(42 ephemeral)
  jq -r --argjson max "$EXPORTER_MAX_USER_CONNECTIONS" --arg q "'" '
    ("\($q)\(.username)\($q)@\($q)%\($q)") as $user
    | "CREATE USER IF NOT EXISTS \($user) IDENTIFIED BY \($q)\(.password)\($q);",
      "ALTER USER \($user) IDENTIFIED BY \($q)\(.password)\($q) REQUIRE SSL WITH MAX_USER_CONNECTIONS \($max);",
      "GRANT PROCESS, REPLICATION CLIENT, REPLICA MONITOR ON *.* TO \($user);",
      "GRANT SELECT ON performance_schema.* TO \($user);"' <<<"$exporter" >"$RUN_DIR/account.sql"

  mariadb --defaults-extra-file="$RUN_DIR/master.cnf" --connect-timeout=10 <"$RUN_DIR/account.sql"
}

ok=0
for delay in 5 10 20 40; do
  if setup_account; then
    ok=1
    break
  fi
  log "exporter 계정 생성 실패, ${delay}초 뒤 다시 시도"
  sleep "$delay"
done
rm -f "$RUN_DIR/master.cnf" "$RUN_DIR/account.sql"
if ((ok == 1)); then
  log "exporter 계정 준비 완료"
else
  log "exporter 계정을 만들지 못했습니다 — 결제 DB 지표 없이 시작합니다 (다음 재시작 때 다시 시도)"
fi

# ── 3. Alloy ──────────────────────────────────────────
# host 네트워크: IMDS hop limit 1 그대로 인스턴스 Role(aps:RemoteWrite)을 쓰고, 127.0.0.1 의 payment-service /metrics 를 읽는다.
# 내장 cadvisor 가 cgroup · Docker 메타데이터를 읽어야 해서 privileged (온프레미스 cadvisor 컨테이너와 같은 마운트). 이미지 기본 사용자는 root
docker rm -f alloy >/dev/null 2>&1 || true
log "Alloy 시작 ($ALLOY_REPOSITORY@${ALLOY_DIGEST:0:19}, $INSTANCE_ID $AZ)"
exec docker run --rm --name alloy --network host --privileged \
  -e INSTANCE_ID="$INSTANCE_ID" -e AZ="$AZ" \
  -e SSL_CERT_DIR="/etc/ssl/certs:/etc/alloy/rds-ca" \
  -v /etc/payment-metrics/config.alloy:/etc/alloy/config.alloy:ro \
  -v "$SECRETS_DIR:/etc/alloy/secrets:ro" \
  -v "$CA_DIR:/etc/alloy/rds-ca:ro" \
  -v "$DATA_DIR:/var/lib/alloy/data" \
  -v /:/rootfs:ro,rslave \
  -v /var/run:/var/run:ro \
  -v /run/udev:/run/udev:ro \
  -v /sys:/sys:ro \
  -v /var/lib/docker/:/var/lib/docker:ro \
  -v /dev/disk/:/dev/disk:ro \
  --log-driver awslogs \
  --log-opt awslogs-region="$REGION" \
  --log-opt awslogs-group="$APP_LOG_GROUP" \
  --log-opt awslogs-stream="$INSTANCE_ID/alloy" \
  --log-opt mode=non-blocking \
  "$IMAGE" run \
  --server.http.listen-addr=127.0.0.1:"$ALLOY_PORT" \
  --storage.path=/var/lib/alloy/data \
  /etc/alloy/config.alloy
