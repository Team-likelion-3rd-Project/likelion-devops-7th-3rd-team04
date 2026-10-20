# 🔒 상시 유지 외부 비밀값. 매일 재생성 스택이 만들 수 없는 값(사람이 외부에서 발급)을 고정 이름 Secret 으로 둔다.
#
#   team04-hotel/prod/ci-runner-tailscale : {oauth_client_secret}  Tailscale OAuth client (tag:ci-runner)
#   team04-hotel/prod/ci-runner-gitlab    : {url, token}           온프레미스 GitLab 의 AWS Runner(aws-ci-runner) 인증 토큰
#
# 값은 ephemeral 변수 → write-only(secret_string_wo) 로 넣어 state · plan 에 남지 않는다.
# write-only 값은 생성 시와 *_version 이 바뀔 때만 전달되므로, 값을 바꿀 때는 env 를 불러온 뒤 version 을 올려 apply 한다 (README 5절).
# 이 스택은 값 등록 때만 직접 apply 한다 (run --all 대상 아님, terragrunt.hcl).
#
# 읽는 쪽은 40-cicd 의 Runner Role(고정 이름 var.ci_runner_role_name)이다. 이름으로 ARN 을 만들므로 40 과 의존 관계가 없다.

locals {
  secret_prefix = "${var.project}/${var.environment}"

  secrets = {
    ci_runner_tailscale = {
      name        = "${local.secret_prefix}/ci-runner-tailscale"
      description = "AWS GitLab Runner Tailscale OAuth client (tag:ci-runner)"
    }
    ci_runner_gitlab = {
      name        = "${local.secret_prefix}/ci-runner-gitlab"
      description = "AWS GitLab Runner URL and authentication token (aws-ci-runner)"
    }
  }
}

resource "aws_secretsmanager_secret" "this" {
  for_each = local.secrets

  name        = each.value.name
  description = each.value.description

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret_version" "ci_runner_tailscale" {
  secret_id = aws_secretsmanager_secret.this["ci_runner_tailscale"].id

  secret_string_wo         = jsonencode({ oauth_client_secret = var.ci_runner_tailscale_oauth_client_secret })
  secret_string_wo_version = var.ci_runner_credentials_version
}

resource "aws_secretsmanager_secret_version" "ci_runner_gitlab" {
  secret_id = aws_secretsmanager_secret.this["ci_runner_gitlab"].id

  secret_string_wo = jsonencode({
    url   = var.ci_runner_gitlab_url
    token = var.ci_runner_gitlab_token
  })
  secret_string_wo_version = var.ci_runner_credentials_version
}

# 값 조회(GetSecretValue)는 Runner Role 과 관리자(이 스택을 apply 하는 주체)만 허용한다 (41-main-data 와 같은 방식).
# 공유 계정이라 관리자 ARN 을 레포에 적지 않고 실행 주체에서 읽는다. 계정 자리를 * 로 두지 않는다 (최소 권한)
data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

data "aws_iam_policy_document" "ci_runner" {
  statement {
    sid       = "DenyGetSecretValueExceptAllowedPrincipals"
    effect    = "Deny"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalArn"
      values = [
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${var.ci_runner_role_name}",
        data.aws_iam_session_context.current.issuer_arn,
      ]
    }
  }
}

resource "aws_secretsmanager_secret_policy" "this" {
  for_each = aws_secretsmanager_secret.this

  secret_arn          = each.value.arn
  policy              = data.aws_iam_policy_document.ci_runner.json
  block_public_policy = true
}
