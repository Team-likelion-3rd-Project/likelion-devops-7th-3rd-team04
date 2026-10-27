#!/bin/sh
# 커밋 X 를 릴리스할 때 쓸 GHCR 이미지의 태그(커밋 SHA 40자)를 출력한다.
#
# GitLab develop 파이프라인은 아래 경로가 바뀐 커밋에서만 돈다 (.gitlab-ci.yml workflow:rules:changes).
# 그 파이프라인이 GHCR <서비스>:<커밋 SHA> 를 올리므로 (백엔드 변경 = push:ghcr, 프론트만 변경 = push:ghcr-reuse 재태깅),
# X 에서 first-parent 로 거슬러 올라가 이 경로를 마지막으로 바꾼 커밋이 이미지가 있는 커밋이다.
# 그 뒤 X 까지의 커밋은 이 경로를 바꾸지 않았으므로 이미지 내용(백엔드 경로)이 X 와 같다.
#
#   ⚠️ 경로 목록은 .gitlab-ci.yml 의 workflow:rules:changes 와 같아야 한다 (한쪽을 바꾸면 다른 쪽도).
#
# 쓰는 곳: .github/workflows/release.yml (X = 릴리스 커밋), ghcr-retention.yml (X = 열린 release/* head — 보존할 태그)
# 필요: git (X 까지의 first-parent 이력, actions/checkout fetch-depth: 0)
# 사용: sh infra/gitops/scripts/image-sha.sh <커밋>
set -eu

X="${1:?사용: image-sha.sh <커밋>}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# .gitlab-ci.yml workflow:rules:changes (backend/**/* 등) 와 같은 경로
WORKFLOW_PATHS="backend backend-deploy langchain_rag frontend infra/gitops/prod/frontend .gitlab-ci.yml"

# shellcheck disable=SC2086 # 경로 목록을 단어로 나눈다
sha="$(git -C "$ROOT" log -1 --first-parent --format=%H "$X" -- $WORKFLOW_PATHS)"
[ -n "$sha" ] || { echo "[image-sha] $X 이전에 파이프라인 경로를 바꾼 커밋이 없습니다 (clone 이력 확인)" >&2; exit 1; }
echo "$sha"
