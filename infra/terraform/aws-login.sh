#!/usr/bin/env bash
#
# team04 프로필로 aws login 을 진행하고, 로그인/인증 상태를 확인한다.
#
# 사용법:
#   ./aws-login.sh                  # 리전 us-east-1
#   ./aws-login.sh -r ap-northeast-2
#
set -euo pipefail

PROFILE="team04"
REGION="us-east-1"
MIN_CLI_VERSION="2.32.0"

usage() {
  cat <<EOF
사용법: $(basename "$0") [-r REGION]

옵션:
  -r, --region REGION   team04 프로필에 설정할 리전 (기본값: us-east-1)
  -h, --help            도움말 출력
EOF
}

# $1 >= $2 이면 0 반환 (x.y.z 형식 버전 비교)
version_ge() {
  local IFS=.
  local -a a=($1) b=($2)
  for i in 0 1 2; do
    if (( ${a[i]:-0} > ${b[i]:-0} )); then return 0; fi
    if (( ${a[i]:-0} < ${b[i]:-0} )); then return 1; fi
  done
  return 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -r|--region)
      [[ -n "${2:-}" ]] || { echo "❌ $1 옵션에 리전 값이 필요합니다." >&2; exit 1; }
      REGION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "❌ 알 수 없는 옵션: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# 0. AWS CLI 확인
if ! command -v aws >/dev/null 2>&1; then
  echo "❌ AWS CLI 가 설치되어 있지 않습니다." >&2
  exit 1
fi

cli_version="$(aws --version 2>&1 | sed -E 's#^aws-cli/([0-9.]+).*#\1#')"
if ! version_ge "$cli_version" "$MIN_CLI_VERSION"; then
  echo "❌ AWS CLI $MIN_CLI_VERSION 이상이 필요합니다. (현재: $cli_version)" >&2
  echo "   brew upgrade awscli 로 업그레이드하세요." >&2
  exit 1
fi

# 1. 프로필 리전 설정
echo "▶ [$PROFILE] 프로필 리전 설정: $REGION"
aws configure set region "$REGION" --profile "$PROFILE"

# 2. aws login
echo "▶ aws login 진행 (브라우저에서 로그인하세요)"
aws login --profile "$PROFILE" --region "$REGION"

# 3. 프로필 존재 확인
echo
echo "▶ 프로필 목록 확인"
if aws configure list-profiles | grep -qx "$PROFILE"; then
  profile_result="✅ 프로필 존재"
else
  profile_result="❌ 프로필 없음"
fi
aws configure list --profile "$PROFILE"

# 4. 실제 인증 확인
echo
echo "▶ 인증 확인 (sts get-caller-identity)"
if identity="$(aws sts get-caller-identity --profile "$PROFILE" \
      --query '[Account, Arn]' --output text 2>&1)"; then
  read -r account arn <<<"$identity"
  auth_result="✅ 인증 성공"
else
  auth_result="❌ 인증 실패"
  account="-"
  arn="$identity"
fi

# 5. 결과 출력
echo
echo "================ 결과 ================"
echo " Profile : $PROFILE  ($profile_result)"
echo " Region  : $(aws configure get region --profile "$PROFILE")"
echo " Auth    : $auth_result"
echo " Account : $account"
echo " Arn     : $arn"
echo "======================================"

[[ "$auth_result" == ✅* ]]
