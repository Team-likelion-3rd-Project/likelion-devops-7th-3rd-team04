#!/bin/sh
# 운영 릴리스 계획 — main 커밋 M 에서 바뀐 컴포넌트와 복사할 GHCR 이미지 커밋을 정한다 (.github/workflows/release.yml plan job).
#
#   1) X = M^2 (release/* head). M 은 release PR 의 merge commit 이고, 트리가 X 와 같아야 한다 (main 에만 있는 변경이 섞이면 거부)
#   2) 이전 릴리스(gitops main 의 현재 값)와 X 를 컴포넌트 경로로 비교
#        backend : 이미지 · 차트 (backend backend-deploy langchain_rag .gitlab-ci.yml — .gitlab-ci.yml .paths backend 와 같게)
#                  이전 값 = envs/prod/backend/chart.yaml revision (이전 백엔드 릴리스의 main 커밋)
#        frontend: 프론트 소스 · 운영 빌드 값 · 빌드 스크립트 (frontend infra/gitops/prod/frontend infra/gitops/scripts/frontend-build.sh)
#                  이전 값 = envs/prod/frontend/values.yaml version
#      이전 값이 자리표시(0000…)이거나 이 clone 에 없는 커밋이면 바뀐 것으로 본다 (첫 릴리스)
#      클러스터 설정(infra/gitops/prod 의 나머지)은 여기서 정하지 않는다 — release-pr.sh 가 복사 후 gitops 와 비교한다
#   3) I = image-sha.sh X (backend 가 바뀐 경우 GHCR <서비스>:I 를 ECR <서비스>:M 으로 복사)
#
# 결과는 KEY=value 줄로 stdout 에 출력한다 (release.yml 이 $GITHUB_OUTPUT 에 붙임). 판단 근거는 stderr.
# 필요: git (fetch-depth: 0)
# 환경변수: M(main 커밋), PREV_BACKEND, PREV_FRONTEND (gitops main 의 현재 값, 없으면 빈 값)
set -eu

: "${M:?}"
PREV_BACKEND="${PREV_BACKEND:-}"
PREV_FRONTEND="${PREV_FRONTEND:-}"

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKEND_PATHS="backend backend-deploy langchain_rag .gitlab-ci.yml"
FRONTEND_PATHS="frontend infra/gitops/prod/frontend infra/gitops/scripts/frontend-build.sh"

log() { echo "[release-plan] $*" >&2; }
g() { git -C "$ROOT" "$@"; }

# ── 1) X ─────────────────────────────────────────────────────
M="$(g rev-parse --verify "$M^{commit}")"
X="$(g rev-parse --verify --quiet "$M^2")" || {
  log "$M 은 merge commit 이 아닙니다 — main 은 release/* PR 의 merge commit 으로만 바뀝니다"; exit 1
}
if ! g diff --quiet "$X" "$M"; then
  log "main 커밋 $M 의 트리가 release head $X 와 다릅니다 (main 에만 있는 변경):"
  g diff --stat "$X" "$M" >&2
  exit 1
fi
log "M=$M X=$X"

# ── 2) 컴포넌트 ──────────────────────────────────────────────
# changed <이름> <이전 커밋> <경로...> — 바뀌었으면 true
changed() {
  name="$1"; prev="$2"; shift 2
  if ! printf '%s' "$prev" | grep -Eq '^[0-9a-f]{40}$' || [ "$prev" = 0000000000000000000000000000000000000000 ]; then
    log "$name: 이전 값 '${prev:-없음}' 이 커밋 SHA 가 아님 (첫 릴리스) → 바뀜"; echo true; return
  fi
  if ! g cat-file -e "$prev^{commit}" 2>/dev/null; then
    log "$name: 이전 커밋 $prev 가 이 clone 에 없음 → 바뀜"; echo true; return
  fi
  if g diff --quiet "$prev" "$X" -- "$@"; then
    log "$name: $prev 이후 변경 없음 → 유지"; echo false
  else
    log "$name: $prev 이후 변경 → 갱신"
    g diff --stat "$prev" "$X" -- "$@" | tail -n 1 >&2
    echo true
  fi
}

# shellcheck disable=SC2086 # 경로 목록을 단어로 나눈다
BACKEND="$(changed backend "$PREV_BACKEND" $BACKEND_PATHS)"
# shellcheck disable=SC2086
FRONTEND="$(changed frontend "$PREV_FRONTEND" $FRONTEND_PATHS)"

# ── 3) 이미지 커밋 ───────────────────────────────────────────
I="$(sh "$ROOT/infra/gitops/scripts/image-sha.sh" "$X")"
log "이미지 커밋 I=$I (backend=$BACKEND 일 때 복사)"

echo "release_sha=$M"
echo "release_head=$X"
echo "image_sha=$I"
echo "backend=$BACKEND"
echo "frontend=$FRONTEND"
