#!/bin/sh
# GitLab release:gitops-pr job (main, AWS Runner) — prod gitops 레포에 릴리스 PR 을 만든다.
#
#   1) GitHub App 자격 증명(Secrets Manager) → JWT → 설치 토큰 (1시간, gitops 레포 contents · pull_requests 쓰기만)
#   2) 같은 SHA 의 PR 이 이미 열려 있으면 종료 (job 재시도 대비)
#   3) gitops 클론 → infra/gitops/prod/<앱> 을 envs/prod/<앱> 으로 복사 (gitops 에만 있는 envs/prod/payment 는 유지)
#   4) backend 이미지 태그 · chart revision · payment 이미지 태그 = 이 main 커밋 SHA
#   5) release/<SHA> 브랜치 push → PR 생성. merge 는 사람 (gitops main ruleset — App 은 우회 불가)
#
# 키 · 토큰은 출력하지 않고, git 에는 URL 대신 HTTP 헤더로 넘긴다 (오류 메시지 · 원격 URL 에 남지 않게).
# 필요: sh, aws, jq, yq(v4), git, curl, openssl — GitLab job 이미지 $DEPLOY_IMAGE(alpine/k8s) + apk openssl
# 환경변수: CI_COMMIT_SHA, CI_PROJECT_DIR, GITOPS_GITHUB_REPO(owner/name), MONOREPO_GITHUB_URL, GITHUB_APP_SECRET
set -eu
# 파이프 중간(curl 등)의 실패를 놓치지 않게 (busybox ash · bash 모두 지원)
set -o pipefail

: "${CI_COMMIT_SHA:?}" "${CI_PROJECT_DIR:?}" "${GITOPS_GITHUB_REPO:?}" "${MONOREPO_GITHUB_URL:?}" "${GITHUB_APP_SECRET:?}"

SHA="$CI_COMMIT_SHA"
SHORT="$(printf '%s' "$SHA" | cut -c1-8)"
BRANCH="release/$SHA"
OWNER="${GITOPS_GITHUB_REPO%%/*}"
API=https://api.github.com
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export SHA

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

# ── 3) gitops 클론 · 값 복사 ─────────────────────────────────
git_auth clone -q --depth 1 "https://github.com/$GITOPS_GITHUB_REPO.git" "$WORK/gitops"
cd "$WORK/gitops"
git checkout -q -b "$BRANCH"

PREV_REVISION="$(yq '.revision' envs/prod/backend/chart.yaml)"

# 앱 정의(chart.yaml)가 있는 폴더만 통째로 바꾼다. 모노레포에서 지운 앱은 지우지 않는다 (agent 도 릴리스를 지우지 않음)
for dir in "$CI_PROJECT_DIR"/infra/gitops/prod/*/; do
  app="$(basename "$dir")"
  [ -f "$dir/chart.yaml" ] || continue
  rm -rf "envs/prod/$app"
  cp -R "$dir" "envs/prod/$app"
done

# ── 4) 이미지 태그 · chart revision = main 커밋 SHA ─────────────
yq -i '.global.imageTag = strenv(SHA) | .global.imageTag line_comment = "릴리스 main 커밋 SHA (GitLab release:gitops-pr)"' envs/prod/backend/values.yaml
yq -i '.revision = strenv(SHA) | .revision line_comment = "릴리스 main 커밋 SHA (GitLab release:gitops-pr)"' envs/prod/backend/chart.yaml
yq -i '.image.imageTag = strenv(SHA) | .image.imageTag line_comment = "릴리스 main 커밋 SHA (GitLab release:gitops-pr)"' envs/prod/payment/values.yaml

git add -A envs/prod
if git diff --cached --quiet; then
  log "gitops main 이 이미 $SHORT 와 같습니다 — PR 을 만들지 않습니다"
  exit 0
fi
CHANGED="$(git diff --cached --stat | tail -n 30)"
git -c user.name="team04-hotel-release-bot" -c user.email="release-bot@users.noreply.github.com" \
  commit -q -m "chore(prod): backend · payment → $SHORT"

# ── 5) push · PR 생성 ───────────────────────────────────────
# 열린 PR 이 없는데 브랜치만 남아 있으면(이전 시도) 덮어쓴다
git_auth push -q --force origin "$BRANCH"

BODY="$(cat <<EOF
GitLab main 파이프라인이 자동으로 만든 릴리스 PR 입니다. **리뷰 · 승인 후 merge 하면 운영에 반영됩니다** (메인 클러스터 배포 agent, 결제 서버는 Parameter Store 동기화 후 pull agent).

## 변경 대상

- [x] backend 이미지 태그 · chart revision → \`$SHA\`
- [x] 결제 서버 이미지 태그 → \`$SHA\`
- [x] 클러스터 서비스 · backend 설정 (모노레포 \`infra/gitops/prod\` 복사)

## 무엇을 · 왜

- 모노레포 main 커밋: $MONOREPO_GITHUB_URL/commit/$SHA
- 이전 릴리스 대비 변경: $MONOREPO_GITHUB_URL/compare/$PREV_REVISION...$SHA
- 이미지: ECR \`team04-hotel/<서비스>:$SHA\` (arm64, AWS Runner kaniko 빌드)

\`\`\`
$CHANGED
\`\`\`

## 배포 순서 확인

- [ ] 결제 쪽 계약(payment.proto · SQS 메시지 · 결제 마이그레이션)이 바뀌는 배포라면 **결제 서버를 먼저** 반영합니다
- [ ] 메인 DB 마이그레이션이 포함된 경우, 이전 버전 앱과 함께 동작 가능한 변경인지 확인했습니다 (롤백 대비)

## 롤백 방법

- 이 PR revert

## 체크리스트

- [x] 비밀값(비밀번호 · 키 · 토큰)이 없습니다 — 이 레포는 public 입니다
- [ ] \`validate\` 체크가 통과했습니다
EOF
)"

PR_URL="$(jq -n --arg title "chore(prod): backend · payment → $SHORT" --arg head "$BRANCH" --arg body "$BODY" \
  '{title: $title, head: $head, base: "main", body: $body}' |
  gh_api -X POST "$API/repos/$GITOPS_GITHUB_REPO/pulls" -d @- | jq -r .html_url)"
[ -n "$PR_URL" ] && [ "$PR_URL" != null ] || { log "PR 생성 응답에 URL 이 없습니다"; exit 1; }
log "릴리스 PR: $PR_URL"
