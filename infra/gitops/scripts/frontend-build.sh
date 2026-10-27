#!/bin/sh
# 프론트엔드 운영 빌드 — 운영 빌드 값(infra/gitops/prod/frontend/values.yaml 의 build)을 검사하고 frontend/dist 를 만든다.
#
#   GitLab release:frontend-build (main) : 운영 값 그대로. VITE_TOSS_CLIENT_KEY 는 release:prepare 가 Parameter Store 에서 읽어 넘김
#   GitLab frontend:build (develop)      : FRONTEND_PAYMENT_MODE=MOCK FRONTEND_LINT=true — 키 없이 빌드 검증 (배포 없음)
#
#   1) build 에는 VITE_* 키만, VITE_TOSS_CLIENT_KEY 는 레포에 두지 않음 (공개 레포로 복사되는 파일)
#   2) build 값을 환경 변수로 → FRONTEND_PAYMENT_MODE 가 있으면 VITE_PAYMENT_MODE 를 덮어씀
#   3) VITE_PAYMENT_MODE=TOSS 면 토스 결제위젯 클라이언트 키(test_|live_gck_) 필요
#   4) npm ci --ignore-scripts (운영 job 은 IMDS 로 Runner Role 을 받으므로 의존성 설치 스크립트를 실행하지 않음) → (lint) → build
#
# 필요: sh, yq(v4), node · npm — GitLab job 이미지 $NODE_IMAGE + apk yq-go
# 환경변수(선택): FRONTEND_VALUES, FRONTEND_PAYMENT_MODE, FRONTEND_LINT=true, VITE_TOSS_CLIENT_KEY
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FRONTEND_VALUES="${FRONTEND_VALUES:-$ROOT/infra/gitops/prod/frontend/values.yaml}"

log() { echo "[frontend-build] $*"; }

# ── 1) build 값 검사 ──────────────────────────────────────────
bad="$(yq '.build | keys | .[] | select(test("^VITE_[A-Z0-9_]+$") | not)' "$FRONTEND_VALUES")"
if [ -n "$bad" ]; then log "$FRONTEND_VALUES build 에는 VITE_* 키만 둡니다: $bad"; exit 1; fi
if [ -n "$(yq '.build.VITE_TOSS_CLIENT_KEY // ""' "$FRONTEND_VALUES")" ]; then
  log "VITE_TOSS_CLIENT_KEY 는 레포에 두지 않습니다 — 12-secrets Parameter Store 에서 읽습니다 ($FRONTEND_VALUES)"; exit 1
fi

# ── 2) 환경 변수로 ────────────────────────────────────────────
set -a; eval "$(yq -o=shell '.build' "$FRONTEND_VALUES")"; set +a
if [ -n "${FRONTEND_PAYMENT_MODE:-}" ]; then
  export VITE_PAYMENT_MODE="$FRONTEND_PAYMENT_MODE"
fi

# ── 3) 토스 키 ────────────────────────────────────────────────
if [ "${VITE_PAYMENT_MODE:-}" = "TOSS" ] && ! printf '%s' "${VITE_TOSS_CLIENT_KEY:-}" | grep -Eq '^(test|live)_gck_'; then
  log "VITE_PAYMENT_MODE=TOSS 는 토스 클라이언트 키가 필요합니다 — 12-secrets TOSS_CLIENT_KEY 등록 · release:prepare 로그 확인"; exit 1
fi
log "VITE_API_URL=${VITE_API_URL:-} VITE_PAYMENT_MODE=${VITE_PAYMENT_MODE:-}"

# ── 4) 빌드 ──────────────────────────────────────────────────
cd "$ROOT/frontend"
npm ci --ignore-scripts --no-audit --no-fund
if [ "${FRONTEND_LINT:-}" = "true" ]; then npm run lint; fi
npm run build
log "빌드 완료 — $ROOT/frontend/dist"
