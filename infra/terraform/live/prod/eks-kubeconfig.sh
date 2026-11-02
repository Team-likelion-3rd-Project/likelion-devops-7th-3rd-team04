#!/usr/bin/env bash
#
# 72-main-cluster-eks 클러스터 접속 정보를 로컬 kubeconfig 에 넣고 current-context 로 바꾼 뒤 접속을 확인한다.
# 다른 클러스터 context 는 그대로 둔다. 클러스터를 매일 다시 만들므로 재생성 후 다시 실행한다.
#
# 사용법:
#   ./eks-kubeconfig.sh                  # ~/.kube/config (KUBECONFIG 를 지정하면 그 파일)
#   ./eks-kubeconfig.sh -a team04-eks    # context 이름 지정
#
set -euo pipefail

PROFILE="team04"
REGION="us-east-1"
CLUSTER="team04-hotel-main-eks" # 72 cluster_name
ALIAS="team04-eks"

usage() {
  cat <<EOF
사용법: $(basename "$0") [-a ALIAS]

옵션:
  -a, --alias ALIAS     kubeconfig context 이름 (기본값: team04-eks)
  -h, --help            도움말 출력
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--alias)
      [[ -n "${2:-}" ]] || { echo "❌ $1 옵션에 이름 값이 필요합니다." >&2; exit 1; }
      ALIAS="$2"
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

for cmd in aws kubectl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "❌ $cmd 가 설치되어 있지 않습니다." >&2; exit 1; }
done

# 1. 로그인 · 클러스터 확인
if ! aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1; then
  echo "❌ [$PROFILE] 인증 실패. infra/terraform/aws-login.sh 를 실행하세요." >&2
  exit 1
fi

status="$(aws eks describe-cluster --profile "$PROFILE" --region "$REGION" --name "$CLUSTER" \
  --query cluster.status --output text 2>/dev/null || true)"
if [[ "$status" != "ACTIVE" ]]; then
  echo "❌ 클러스터 $CLUSTER 가 ACTIVE 가 아닙니다 (상태: ${status:-없음}). 72-main-cluster-eks 를 확인하세요." >&2
  exit 1
fi

# 2. kubeconfig 갱신 (토큰은 파일에 저장되지 않고 kubectl 실행 때 이 프로필로 받는다)
aws eks update-kubeconfig --profile "$PROFILE" --region "$REGION" --name "$CLUSTER" --alias "$ALIAS" >/dev/null
echo "✅ context: $ALIAS"

# 3. 접속 확인
if ! kubectl --context "$ALIAS" --request-timeout=10s get nodes; then
  echo "❌ API 서버 접속 실패." >&2
  echo "   지금 공인 IP 가 72 terraform.tfvars public_access_cidrs 에 있는지 확인하세요." >&2
  echo "   Access Entry 는 apply 주체(+ cluster_admin_principal_arns)에만 있습니다." >&2
  exit 1
fi
