#!/bin/sh
# prod gitops 레포에 릴리스 PR 을 만든다 — GitHub Actions release.yml gitops-pr job (main, 릴리스 Role).
#
#   1) GitHub App 자격 증명(Secrets Manager) → JWT → 설치 토큰 (1시간, gitops 레포 contents · pull_requests 쓰기만)
#   2) 같은 SHA 의 PR 이 이미 열려 있으면 종료 (job 재시도 대비)
#   3) gitops 클론 → 현재 배포 값(이미지 태그 · revision · 프론트 version) 보존
#      → infra/gitops/prod/<앱> · root 앱 차트 · frontend 를 envs/prod/ 로 복사 (gitops 에만 있는 envs/prod/payment 는 유지)
#      → 보존한 값 복원 (모노레포의 자리표시 0000… 이 gitops 로 들어가지 않게). 이 상태의 차이 = 클러스터 설정 변경
#   4) 바뀐 컴포넌트만 이 main 커밋 SHA 로 갱신
#        RELEASE_BACKEND=true  : backend 이미지 태그 · chart revision · payment 이미지 태그
#        RELEASE_FRONTEND=true : frontend version
#   5) release/<SHA> 브랜치 push → PR 생성. merge 는 사람 (gitops main ruleset — App 은 우회 불가)
#      DRY_RUN=true 면 push · PR 없이 제목 · 본문 · 변경을 출력한다
#
# 키 · 토큰은 출력하지 않고, git 에는 URL 대신 HTTP 헤더로 넘긴다 (오류 메시지 · 원격 URL 에 남지 않게).
# 필요: sh, aws, jq, yq(v4), git, curl, openssl — GitHub ubuntu-24.04 러너
# 환경변수: GITHUB_SHA · GITHUB_WORKSPACE · GITHUB_RUN_ID, GITOPS_GITHUB_REPO(owner/name), MONOREPO_GITHUB_URL, GITHUB_APP_SECRET,
#           RELEASE_BACKEND · RELEASE_FRONTEND (true/false, release-plan.sh), IMAGE_SHA(GHCR 원본 커밋, RELEASE_BACKEND=true 일 때)
#   선택  : RELEASE_IMAGES_FILE(<서비스> <digest> 줄), DRY_RUN (기본 false)
set -eu
# 파이프 중간(curl 등)의 실패를 놓치지 않게 (busybox ash · bash 모두 지원)
set -o pipefail

SHA="${GITHUB_SHA:-}"
PROJECT_DIR="${GITHUB_WORKSPACE:-}"
: "${SHA:?}" "${PROJECT_DIR:?}" "${GITOPS_GITHUB_REPO:?}" "${MONOREPO_GITHUB_URL:?}" "${GITHUB_APP_SECRET:?}"
: "${RELEASE_BACKEND:?}" "${RELEASE_FRONTEND:?}"
IMAGE_SHA="${IMAGE_SHA:-}"
if [ "$RELEASE_BACKEND" = "true" ] && [ -z "$IMAGE_SHA" ]; then
  echo "[release-pr] RELEASE_BACKEND=true 인데 IMAGE_SHA 가 없습니다" >&2; exit 1
fi
RELEASE_IMAGES_FILE="${RELEASE_IMAGES_FILE:-}"
DRY_RUN="${DRY_RUN:-false}"

SHORT="$(printf '%s' "$SHA" | cut -c1-8)"
BRANCH="release/$SHA"
OWNER="${GITOPS_GITHUB_REPO%%/*}"
API=https://api.github.com
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export SHA

SOURCE="GitHub Actions release.yml"
SOURCE_URL="$MONOREPO_GITHUB_URL/actions/runs/${GITHUB_RUN_ID:-}"

log() { echo "[release-pr] $*"; }

# ── 1) GitHub App 설치 토큰 ──────────────────────────────────
aws secretsmanager get-secret-value --region us-east-1 --secret-id "$GITHUB_APP_SECRET" \
  --query SecretString --output text > "$WORK/app.json"
APP_ID="$(jq -r .app_id "$WORK/app.json")"
INSTALLATION_ID="$(jq -r .installation_id "$WORK/app.json")"
(umask 077 && jq -r .private_key "$WORK/app.json" > "$WORK/app.pem")
rm -f "$WORK/app.json"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
NOW="$(date +%s)"
# 시계 오차를 감안해 발급 시각을 60초 앞당기고, 유효 기간은 GitHub 최대(10분) 안으로
HEADER="$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)"
PAYLOAD="$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((NOW - 60))" "$((NOW + 540))" "$APP_ID" | b64url)"
SIGNATURE="$(printf '%s.%s' "$HEADER" "$PAYLOAD" | openssl dgst -sha256 -sign "$WORK/app.pem" -binary | b64url)"
rm -f "$WORK/app.pem"

curl -fsS -X POST \
  -H "Authorization: Bearer $HEADER.$PAYLOAD.$SIGNATURE" \
  -H "Accept: application/vnd.github+json" \
  "$API/app/installations/$INSTALLATION_ID/access_tokens" > "$WORK/token.json"
TOKEN="$(jq -r .token "$WORK/token.json")"
rm -f "$WORK/token.json"
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || { log "GitHub App 설치 토큰을 받지 못했습니다"; exit 1; }

gh_api() {
  curl -fsS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" "$@"
}
git_auth() {
  git -c http.extraHeader="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | openssl base64 -A)" "$@"
}

# ── 2) 같은 SHA 의 PR 이 이미 있으면 종료 ──────────────────────
EXISTING="$(gh_api "$API/repos/$GITOPS_GITHUB_REPO/pulls?state=open&head=$OWNER:$BRANCH" | jq -r '.[0].html_url // empty')"
if [ -n "$EXISTING" ]; then
  log "이미 열린 릴리스 PR 이 있습니다: $EXISTING"
  exit 0
fi

# ── 3) gitops 클론 · 현재 값 보존 · 복사 · 복원 ──────────────────
git_auth clone -q --depth 1 "https://github.com/$GITOPS_GITHUB_REPO.git" "$WORK/gitops"
cd "$WORK/gitops"
git checkout -q -b "$BRANCH"

# 값과 줄 주석을 함께 보존한다 (복사본의 주석은 모노레포 자리표시 설명)
PREV_BACKEND_TAG="$(yq '.global.imageTag' envs/prod/backend/values.yaml)"
PREV_BACKEND_TAG_COMMENT="$(yq '.global.imageTag | line_comment' envs/prod/backend/values.yaml)"
PREV_REVISION="$(yq '.revision' envs/prod/backend/chart.yaml)"
PREV_REVISION_COMMENT="$(yq '.revision | line_comment' envs/prod/backend/chart.yaml)"
PREV_FRONTEND="$(yq '.version' envs/prod/frontend/values.yaml)"
PREV_FRONTEND_COMMENT="$(yq '.version | line_comment' envs/prod/frontend/values.yaml)"
export PREV_BACKEND_TAG PREV_BACKEND_TAG_COMMENT PREV_REVISION PREV_REVISION_COMMENT PREV_FRONTEND PREV_FRONTEND_COMMENT

# 앱 정의(chart.yaml)가 있는 폴더만 통째로 바꾼다. 모노레포에서 지운 앱은 지우지 않는다 (앱 삭제는 사람이 gitops 레포에서)
for dir in "$PROJECT_DIR"/infra/gitops/prod/*/; do
  app="$(basename "$dir")"
  [ -f "$dir/chart.yaml" ] || continue
  rm -rf "envs/prod/$app"
  cp -R "$dir" "envs/prod/$app"
done

# root 앱 차트(ArgoCD prod-apps 가 렌더링, 앱 정의가 아니라 위 반복에서 빠짐)
for item in Chart.yaml values.yaml templates files; do
  rm -rf "envs/prod/$item"
  cp -R "$PROJECT_DIR/infra/gitops/prod/$item" "envs/prod/$item"
done

# 프론트는 앱 정의가 아니라(ArgoCD 가 읽지 않음) 위 반복에서 빠진다. merge 후 gitops sync-frontend-version 이 반영한다
rm -rf envs/prod/frontend
cp -R "$PROJECT_DIR/infra/gitops/prod/frontend" envs/prod/frontend

# 모노레포의 자리표시 대신 gitops 의 현재 값으로 되돌린다 (바뀐 컴포넌트는 4 에서 다시 덮어씀)
yq -i '.global.imageTag = strenv(PREV_BACKEND_TAG) | .global.imageTag line_comment = strenv(PREV_BACKEND_TAG_COMMENT)' envs/prod/backend/values.yaml
yq -i '.revision = strenv(PREV_REVISION) | .revision line_comment = strenv(PREV_REVISION_COMMENT)' envs/prod/backend/chart.yaml
yq -i '.version = strenv(PREV_FRONTEND) | .version line_comment = strenv(PREV_FRONTEND_COMMENT)' envs/prod/frontend/values.yaml

git add -A envs/prod
if git diff --cached --quiet; then CONFIG=false; else CONFIG=true; fi

# ── 4) 바뀐 컴포넌트만 이 main 커밋 SHA 로 ─────────────────────
COMMENT="릴리스 main 커밋 SHA ($SOURCE)"
export COMMENT
COMPONENTS=""
add_component() { COMPONENTS="${COMPONENTS:+$COMPONENTS · }$1"; }
if [ "$RELEASE_BACKEND" = "true" ]; then
  yq -i '.global.imageTag = strenv(SHA) | .global.imageTag line_comment = strenv(COMMENT)' envs/prod/backend/values.yaml
  yq -i '.revision = strenv(SHA) | .revision line_comment = strenv(COMMENT)' envs/prod/backend/chart.yaml
  yq -i '.image.imageTag = strenv(SHA) | .image.imageTag line_comment = strenv(COMMENT)' envs/prod/payment/values.yaml
  add_component "backend · payment"
fi
if [ "$RELEASE_FRONTEND" = "true" ]; then
  yq -i '.version = strenv(SHA) | .version line_comment = strenv(COMMENT)' envs/prod/frontend/values.yaml
  add_component frontend
fi
[ "$CONFIG" = "false" ] || add_component "클러스터 설정"
log "바뀐 컴포넌트: ${COMPONENTS:-없음} (backend=$RELEASE_BACKEND frontend=$RELEASE_FRONTEND 설정=$CONFIG)"

git add -A envs/prod
if git diff --cached --quiet; then
  log "gitops main 이 이미 $SHORT 와 같습니다 — PR 을 만들지 않습니다"
  exit 0
fi
CHANGED="$(git diff --cached --stat | tail -n 30)"
TITLE="chore(prod): $COMPONENTS → $SHORT"

# ── 5) PR 본문 ──────────────────────────────────────────────
check() { if [ "$1" = "true" ]; then echo x; else echo " "; fi; }

if [ "$RELEASE_BACKEND" = "true" ]; then
  BACKEND_LINE="ECR \`team04-hotel/<서비스>:$SHA\` ← GHCR \`:$IMAGE_SHA\` (develop 파이프라인 빌드 · smoke test 통과 이미지, 재빌드 없이 복사 · digest 동일, amd64)"
  BACKEND_ITEM="backend 이미지 태그 · chart revision → \`$SHA\`, 결제 서버 이미지 태그 → \`$SHA\`"
else
  BACKEND_LINE="변경 없음 — 이전 릴리스 \`$PREV_REVISION\` 유지"
  BACKEND_ITEM="backend · payment — 변경 없음 (\`$PREV_REVISION\` 유지)"
fi
if [ "$RELEASE_FRONTEND" = "true" ]; then
  FRONTEND_LINE="S3 \`team04-hotel-frontend/releases/$SHA/\` ($SOURCE 빌드)"
  FRONTEND_ITEM="프론트 version → \`$SHA\` (빌드는 S3 \`releases/$SHA/\` 에 업로드 완료)"
else
  FRONTEND_LINE="변경 없음 — 이전 버전 \`$PREV_FRONTEND\` 유지"
  FRONTEND_ITEM="프론트 — 변경 없음 (\`$PREV_FRONTEND\` 유지)"
fi
DIGESTS=""
if [ "$RELEASE_BACKEND" = "true" ] && [ -n "$RELEASE_IMAGES_FILE" ] && [ -s "$RELEASE_IMAGES_FILE" ]; then
  DIGESTS="$(printf '\n<details><summary>이미지 digest (GHCR = ECR)</summary>\n\n```\n%s\n```\n\n</details>\n' "$(cat "$RELEASE_IMAGES_FILE")")"
fi

BODY="$(cat <<EOF
${SOURCE} 이 자동으로 만든 릴리스 PR 입니다. **리뷰 · 승인 후 merge 하면 운영에 반영됩니다** (메인 클러스터는 ArgoCD, 결제 서버는 Parameter Store 동기화 후 pull agent, 프론트는 CloudFront KeyValueStore 전환).

이전 릴리스 이후 바뀐 컴포넌트만 갱신했고, 나머지는 gitops 의 현재 값을 유지합니다.

## 변경 대상

- [$(check "$RELEASE_BACKEND")] $BACKEND_ITEM
- [$(check "$RELEASE_FRONTEND")] $FRONTEND_ITEM
- [$(check "$CONFIG")] 클러스터 서비스 · backend 설정 (모노레포 \`infra/gitops/prod\` 복사)

## 무엇을 · 왜

- 모노레포 main 커밋: $MONOREPO_GITHUB_URL/commit/$SHA
- 이전 백엔드 릴리스 대비 변경: $MONOREPO_GITHUB_URL/compare/$PREV_REVISION...$SHA
- 이미지: $BACKEND_LINE
- 프론트: $FRONTEND_LINE
${SOURCE_URL:+- 실행: $SOURCE_URL}
$DIGESTS

\`\`\`
$CHANGED
\`\`\`

## 배포 순서 확인

- [ ] 결제 쪽 계약(payment.proto · SQS 메시지 · 결제 마이그레이션)이 바뀌는 배포라면 **결제 서버를 먼저** 반영합니다
- [ ] 메인 DB 마이그레이션이 포함된 경우, 이전 버전 앱과 함께 동작 가능한 변경인지 확인했습니다 (롤백 대비)
- [ ] API 응답 · 요청 형식을 바꾸거나 지운 경우, 이전 프론트와도 동작하는지 확인했습니다 (프론트만 롤백 대비)

## 롤백 방법

- 전체: 이 PR revert
- 프론트만: \`envs/prod/frontend/values.yaml\` 의 \`version\` 을 이전 릴리스 SHA 로 바꾸는 PR
- 백엔드만: \`envs/prod/backend\` 의 \`imageTag\` · \`revision\` 을 이전 릴리스 SHA 로 바꾸는 PR

## 체크리스트

- [x] 비밀값(비밀번호 · 키 · 토큰)이 없습니다 — 이 레포는 public 입니다
- [ ] \`validate\` 체크가 통과했습니다
EOF
)"

if [ "$DRY_RUN" = "true" ]; then
  log "dry-run — push · PR 생략. 제목: $TITLE"
  printf '%s\n' "----- PR 본문 -----" "$BODY" "----- 변경 (envs/prod) -----"
  git --no-pager diff --cached
  exit 0
fi

# ── 6) push · PR 생성 ───────────────────────────────────────
git -c user.name="team04-hotel-release-bot" -c user.email="release-bot@users.noreply.github.com" \
  commit -q -m "$TITLE"
# 열린 PR 이 없는데 브랜치만 남아 있으면(이전 시도) 덮어쓴다
git_auth push -q --force origin "$BRANCH"

PR_URL="$(jq -n --arg title "$TITLE" --arg head "$BRANCH" --arg body "$BODY" \
  '{title: $title, head: $head, base: "main", body: $body}' |
  gh_api -X POST "$API/repos/$GITOPS_GITHUB_REPO/pulls" -d @- | jq -r .html_url)"
[ -n "$PR_URL" ] && [ "$PR_URL" != null ] || { log "PR 생성 응답에 URL 이 없습니다"; exit 1; }
log "릴리스 PR: $PR_URL"
