#!/usr/bin/env bash
# GitOps pull 배포 agent. CronJob gitops-sync(1분)이 실행한다 (infra/gitops/prod/README.md).
#
#   1) 대상 브랜치(BRANCH) SHA 조회 → 상태 ConfigMap 의 applied_sha · failed_sha 와 같으면 종료
#   2) 가져오기: gitops 레포 그 SHA 와 각 앱 차트(helm pull · git fetch). 실패하면 기록하지 않고 종료 → 다음 실행이 재시도
#   3) 적용: order 순 helm upgrade --install --atomic. 실패하면 failed_sha 기록 → 브랜치가 바뀔 때까지 재시도 안 함
#
# 앱 = APPS_PATH 아래 chart.yaml 이 있는 폴더. 앞 앱이 적용된 뒤 뒤 앱이 실패해도 앞 앱은 새 버전으로 남는다.
# 폴더를 지워도 릴리스는 삭제하지 않는다 (helm uninstall 은 사람이 한다)
set -Eeuo pipefail

: "${REPO_URL:?}" "${BRANCH:?}" "${APPS_PATH:?}" "${HELM_TIMEOUT:?}" "${POD_NAMESPACE:?}"
STATE_CM=gitops-sync-state
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# stdout 은 앱 목록 수집에 쓰므로 로그는 stderr 로
log() { echo "[gitops-sync] $*" >&2; }

state() {
  kubectl -n "$POD_NAMESPACE" get configmap "$STATE_CM" -o "jsonpath={.data.$1}" 2>/dev/null || true
}

# $1: data 에 합칠 JSON 객체 (updated_at 은 자동)
patch_state() {
  kubectl -n "$POD_NAMESPACE" get configmap "$STATE_CM" >/dev/null 2>&1 ||
    kubectl -n "$POD_NAMESPACE" create configmap "$STATE_CM" >/dev/null
  kubectl -n "$POD_NAMESPACE" patch configmap "$STATE_CM" --type merge \
    -p "$(jq -cn --argjson d "$1" '{data: ($d + {updated_at: (now | todate)})}')" >/dev/null
}

# ── 1) 대상 SHA ──
target="$(git ls-remote --exit-code "$REPO_URL" "refs/heads/$BRANCH" | cut -f1)" ||
  { log "브랜치 조회 실패: $REPO_URL $BRANCH (다음 실행에서 재시도)"; exit 1; }
applied="$(state applied_sha)"
failed="$(state failed_sha)"

if [[ "$target" == "$applied" ]]; then
  log "변경 없음 ($BRANCH $target)"
  exit 0
fi
if [[ "$target" == "$failed" ]]; then
  log "실패한 SHA 라 건너뜀 ($BRANCH $target, 앱 $(state failed_app)). 수정 커밋을 push 하면 다시 적용한다"
  exit 0
fi
log "적용 시작: $BRANCH $target (이전 적용 ${applied:-없음})"

# ── 2) 가져오기 ──
fetch_fail() { log "가져오기 실패: $* (기록하지 않음, 다음 실행에서 재시도)"; exit 1; }

repo="$WORK/gitops"
git init -q "$repo"
git -C "$repo" fetch -q --depth 1 "$REPO_URL" "$target" || fetch_fail "gitops 레포 $target"
git -C "$repo" checkout -q FETCH_HEAD

# "order 앱폴더" 를 order 순으로. enabled: false 는 건너뜀
apps=()
while read -r _ dir; do apps+=("$dir"); done < <(
  for def in "$repo/$APPS_PATH"/*/chart.yaml; do
    [[ -e "$def" ]] || continue
    # yq 의 // 는 false 도 빈 값으로 보므로 쓰지 않는다
    [[ "$(yq '.enabled' "$def")" != "false" ]] || { log "건너뜀(enabled: false): $(basename "$(dirname "$def")")"; continue; }
    printf '%05d %s\n' "$(yq '.order // 50' "$def")" "$(dirname "$def")"
  done | sort
)

declare -A chart_ref
for dir in "${apps[@]}"; do
  app="$(basename "$dir")"
  def="$dir/chart.yaml"
  type="$(yq '.type' "$def")"
  dest="$WORK/charts/$app"
  mkdir -p "$dest"
  case "$type" in
    helm)
      chart="$(yq '.chart' "$def")"
      version="$(yq '.version' "$def")"
      if [[ "$chart" == oci://* ]]; then
        helm pull "$chart" --version "$version" -d "$dest" || fetch_fail "$app 차트 $chart $version"
      else
        helm pull "$chart" --repo "$(yq '.repo' "$def")" --version "$version" -d "$dest" ||
          fetch_fail "$app 차트 $chart $version"
      fi
      chart_ref[$app]="$(ls "$dest"/*.tgz)"
      ;;
    git)
      revision="$(yq '.revision' "$def")"
      path="$(yq '.path' "$def")"
      git init -q "$dest/src"
      git -C "$dest/src" sparse-checkout set --no-cone "/$path/"
      git -C "$dest/src" fetch -q --depth 1 --filter=blob:none "$(yq '.repo' "$def")" "$revision" ||
        fetch_fail "$app 차트 레포 $revision"
      git -C "$dest/src" checkout -q FETCH_HEAD || fetch_fail "$app 차트 $revision checkout"
      chart_ref[$app]="$dest/src/$path"
      ;;
    local)
      chart_ref[$app]="$dir/$(yq '.path // "chart"' "$def")"
      ;;
    *)
      chart_ref[$app]=""   # 적용 단계에서 실패로 기록 (값 오류)
      ;;
  esac
done

# ── 3) 적용 ──
apply_fail() {
  local app="$1" msg="$2"
  log "적용 실패: $app — $msg"
  patch_state "$(jq -cn --arg sha "$target" --arg app "$app" --arg msg "$msg" \
    '{failed_sha: $sha, failed_app: $app, message: $msg}')"
  exit 1
}

for dir in "${apps[@]}"; do
  app="$(basename "$dir")"
  def="$dir/chart.yaml"
  namespace="$(yq '.namespace // ""' "$def")"
  release="$(yq '.release // ""' "$def")"
  [[ -n "${chart_ref[$app]}" ]] || apply_fail "$app" "chart.yaml type 은 helm · git · local 중 하나여야 합니다"
  [[ -n "$namespace" && -n "$release" ]] || apply_fail "$app" "chart.yaml 에 namespace · release 가 필요합니다"
  values=()
  [[ -f "$dir/values.yaml" ]] && values=(-f "$dir/values.yaml")

  log "helm upgrade --install $release ($app, -n $namespace)"
  if ! helm upgrade --install "$release" "${chart_ref[$app]}" -n "$namespace" --create-namespace \
    "${values[@]}" --atomic --wait --timeout "$HELM_TIMEOUT" --history-max 5 2>&1 | tee "$WORK/helm.log"; then
    apply_fail "$app" "$(tail -c 800 "$WORK/helm.log")"
  fi
done

patch_state "$(jq -cn --arg sha "$target" '{applied_sha: $sha, failed_sha: "", failed_app: "", message: ""}')"
log "적용 완료: $BRANCH $target (${#apps[@]}개 앱)"
