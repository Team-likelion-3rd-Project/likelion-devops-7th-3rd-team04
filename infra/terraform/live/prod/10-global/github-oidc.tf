# gitops 레포의 GitHub Actions 가 결제 서버 이미지 태그를 Parameter Store 에 쓰기 위한 OIDC 연동.
#
#   gitops 릴리스 PR merge (사람 승인) → GitHub Actions(main) → OIDC 토큰 → 이 Role → SSM PutParameter
#   결제 서버 pull agent 가 VPC 엔드포인트로 같은 파라미터를 읽어 갱신한다 (결제 VPC 는 GitHub 로 나가지 않음).
#
# 장기 액세스 키를 GitHub 에 두지 않는다. Runner 에는 이 쓰기 권한을 주지 않는다 (승인 없이 결제 서버를 바꾸는 경로가 됨).
#
# ⚠️ GitHub OIDC 공급자는 URL 이 고정이라 계정에 하나만 만들 수 있다 — 공유 계정의 다른 팀과 함께 쓰는 리소스다.
#    지우거나 audience 를 바꾸면 그 공급자를 쓰는 다른 팀 Role 도 끊긴다 (prevent_destroy).
#    다른 팀이 먼저 만들었으면 create_github_oidc_provider = false 로 두고 기존 공급자를 그대로 신뢰한다.
#    문제가 되면 계정 공용 리소스 없이 Lambda 폴러(공개 gitops 를 주기적으로 읽어 SSM 갱신)로 바꾼다.

locals {
  github_oidc_host = "token.actions.githubusercontent.com"
  # 공급자를 직접 만들든 기존 것을 쓰든 ARN 은 같다
  github_oidc_provider_arn = "arn:${data.aws_partition.current.partition}:iam::${local.account_id}:oidc-provider/${local.github_oidc_host}"

  # 11-registry 의 결제 서버 이미지 태그 파라미터 (같은 이름 규칙, 스택 의존 없음)
  payment_image_tag_parameter = "/${var.project}/${var.environment}/image-tag/payment-service"
}

# GitHub 발급자는 AWS 가 신뢰하는 루트 CA 로 검증하므로 thumbprint 를 지정하지 않는다
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://${local.github_oidc_host}"
  client_id_list = ["sts.amazonaws.com"]

  lifecycle {
    prevent_destroy = true
  }
}

# 신뢰 정책은 aud · sub 를 정확히 비교한다 — gitops 레포의 main 브랜치 실행만 (PR · 다른 브랜치 · 다른 레포 거부)
data "aws_iam_policy_document" "gitops_ssm_sync_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:sub"
      values   = ["repo:${var.gitops_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "gitops_ssm_sync" {
  name                 = "${var.project}-gitops-ssm-sync"
  description          = "gitops main GitHub Actions: payment image tag to Parameter Store"
  assume_role_policy   = data.aws_iam_policy_document.gitops_ssm_sync_assume.json
  max_session_duration = 3600

  # IAM 이 신뢰 정책의 Federated principal 이 있는지 확인하므로 공급자를 먼저 만든다
  depends_on = [aws_iam_openid_connect_provider.github]
}

# 결제 서버 이미지 태그 파라미터 하나만 쓴다
data "aws_iam_policy_document" "gitops_ssm_sync" {
  statement {
    sid       = "PutPaymentImageTag"
    actions   = ["ssm:PutParameter", "ssm:GetParameter"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.region}:${local.account_id}:parameter${local.payment_image_tag_parameter}"]
  }
}

resource "aws_iam_role_policy" "gitops_ssm_sync" {
  name   = "payment-image-tag"
  role   = aws_iam_role.gitops_ssm_sync.id
  policy = data.aws_iam_policy_document.gitops_ssm_sync.json
}
