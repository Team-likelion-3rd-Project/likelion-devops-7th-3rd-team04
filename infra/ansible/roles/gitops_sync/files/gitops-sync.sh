#!/usr/bin/env bash
# GitOps pull 배포 agent. CronJob gitops-sync(1분)이 실행한다 (infra/gitops/prod/README.md).
#
#   1) 대상 브랜치(BRANCH) SHA 조회 → 상태 ConfigMap 의 applied_sha · failed_sha 와 같으면 종료
#   2) 가져오기: gitops 레포 그 SHA 와 각 앱 차트(helm pull · git fetch). 실패하면 기록하지 않고 종료 → 다음 실행이 재시도
#   3) 적용: order 순 helm upgrade --install --atomic. 실패하면 failed_sha 기록 → 브랜치가 바뀔 때까지 재시도 안 함
#
# 앱 = APPS_PATH 아래 chart.yaml 이 있는 폴더. clusterValues: true 면 CLUSTER_VALUES(Ansible 이 만든 클러스터 값)도 -f 로 넘긴다. 앞 앱이 적용된 뒤 뒤 앱이 실패해도 앞 앱은 새 버전으로 남는다.
# 폴더를 지워도 릴리스는 삭제하지 않는다 (helm uninstall 은 사람이 한다)
#
# 적용 결과(성공 · 실패)는 DEPLOY_TOPIC_ARN 이 있으면 배포 토픽(10-global → AWS Chatbot → Slack #deploy)에 발행한다.
# 클러스터 생성 직후 첫 적용(applied_sha 없음, 매일 재생성)의 성공 · 변경 없음 · 가져오기 실패(재시도)는 발행하지 않는다.
# 첫 적용의 실패는 서비스가 뜨지 않은 것이라 발행한다. 발행 실패는 배포 결과에 영향을 주지 않는다
set -Eeuo pipefail

: "${REPO_URL:?}" "${BRANCH:?}" "${APPS_PATH:?}" "${HELM_TIMEOUT:?}" "${POD_NAMESPACE:?}" "${CLUSTER_VALUES:?}"
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

# $1: success | failed, $2: 실패한 앱, $3: 실패 메시지
notify() {
  [[ -n "${DEPLOY_TOPIC_ARN:-}" ]] || return 0
  [[ "$1" == "failed" || -n "${applied:-}" ]] || return 0
  local title release
  if [[ "$1" == "success" ]]; then
    title=":white_check_mark: 메인 클러스터 배포 성공"
  else
    title=":x: 메인 클러스터 배포 실패 ($2, --atomic 롤백)"
  fi
  # 릴리스 SHA = backend 차트 revision (모노레포 main 커밋, 이미지 태그와 같음)
  release="$(yq '.revision // ""' "$repo/$APPS_PATH/backend/chart.yaml" 2>/dev/null || true)"
  aws sns publish --topic-arn "$DEPLOY_TOPIC_ARN" --message "$(
    jq -cn --arg title "$title" --arg result "$1" --arg release "${release:-?}" --arg target "$target" \
      --arg previous "${applied:-}" --arg seconds "$SECONDS" --arg applied_apps "${applied_apps[*]:-}" \
      --arg failed_app "${2:-}" --arg message "${3:-}" '
      {version: "1.0", source: "custom",
       content: {
         textType: "client-markdown",
         title: $title,
         description: ("*릴리스* `\($release[0:8])`\n*gitops* `\($target[0:7])`"
                       + (if $previous == "" then " (클러스터 생성 후 첫 적용)" else " (이전 `\($previous[0:7])`)" end)
                       + "\n*소요* \($seconds)초\n*적용한 앱* \(if $applied_apps == "" then "없음" else $applied_apps end)"
                       + (if $failed_app == "" then "" else "\n*실패* `\($failed_app)` — 이 앱만 이전 릴리스로 되돌림, 앞 앱은 새 버전 유지\n```\($message)```" end))},
       metadata: {summary: $title, eventType: ("main_deploy_" + $result),
                  additionalContext: {release: $release, gitops: $target}}}')" \
    >/dev/null 2>&1 || log "배포 알림 발행 실패 (배포 결과와 무관)"
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
  notify failed "$app" "$(tail -c 300 <<<"$msg")"
  exit 1
}

applied_apps=()
for dir in "${apps[@]}"; do
  app="$(basename "$dir")"
  def="$dir/chart.yaml"
  namespace="$(yq '.namespace // ""' "$def")"
  release="$(yq '.release // ""' "$def")"
  [[ -n "${chart_ref[$app]}" ]] || apply_fail "$app" "chart.yaml type 은 helm · git · local 중 하나여야 합니다"
  [[ -n "$namespace" && -n "$release" ]] || apply_fail "$app" "chart.yaml 에 namespace · release 가 필요합니다"
  values=()
  [[ -f "$dir/values.yaml" ]] && values=(-f "$dir/values.yaml")
  # 클러스터 값(계정 ID 등)은 쓰는 앱만 받는다. 모르는 키를 거부하는 차트 schema 가 있다
  [[ "$(yq '.clusterValues' "$def")" == "true" ]] && values+=(-f "$CLUSTER_VALUES")

  log "helm upgrade --install $release ($app, -n $namespace)"
  if ! helm upgrade --install "$release" "${chart_ref[$app]}" -n "$namespace" --create-namespace \
    "${values[@]}" --atomic --wait --timeout "$HELM_TIMEOUT" --history-max 5 2>&1 | tee "$WORK/helm.log"; then
    apply_fail "$app" "$(tail -c 800 "$WORK/helm.log")"
  fi
  applied_apps+=("$app")
done

patch_state "$(jq -cn --arg sha "$target" '{applied_sha: $sha, failed_sha: "", failed_app: "", message: ""}')"
log "적용 완료: $BRANCH $target (${#apps[@]}개 앱)"
notify success
