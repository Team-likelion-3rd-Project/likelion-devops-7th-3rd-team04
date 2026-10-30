# 🔒 상시 유지 외부 비밀값. 매일 재생성 스택이 만들 수 없는 값(사람이 외부에서 발급)을 고정 이름 Secret 으로 둔다.
#
#   team04-hotel/prod/github-app          : {app_id, installation_id, private_key}
#                                           gitops 레포 릴리스 PR 용 GitHub App (모노레포 release.yml 이 읽음)
#   team04-hotel/prod/toss-payments       : {secret_key}           토스페이먼츠 시크릿 키 → TOSS_SECRET_KEY (결제 서버가 읽음)
#   team04-hotel/prod/seed-admin          : {email, password, name} 시드 관리자 계정 → backend 시드 Job 의 SEED_ADMIN_*
#                                           (ESO 가 읽어 Secret seed-admin 생성, gitops backend-secrets 앱)
#   team04-hotel/prod/grafana-admin       : {admin_user, admin_password} 운영 Grafana admin 계정
#                                           (ESO 가 읽어 Secret grafana-admin 생성, gitops monitoring 앱)
#
#   SSM /team04-hotel/prod/frontend/toss-client-key (String)       토스 결제위젯 클라이언트 키 → VITE_TOSS_CLIENT_KEY
#                                           release.yml 이 읽어 빌드에 넣는다 (아래 frontend.tf)
#
# 값은 ephemeral 변수 → write-only(secret_string_wo) 로 넣어 state · plan 에 남지 않는다.
# write-only 값은 생성 시와 *_version 이 바뀔 때만 전달되므로, 값을 바꿀 때는 version 을 올려 apply 한다 (README 5절).
# 값은 terragrunt.hcl 이 이 디렉터리의 .env(gitignore)가 가리키는 파일에서 읽어 넘긴다.
# 이 스택은 값 등록 때만 직접 apply 한다 (run --all 대상 아님, terragrunt.hcl).
#
# 읽는 쪽은 10-global 의 릴리스 Role(var.release_role_name, github-app 만), 60-payment-app 의 결제 서버 Role(var.payment_app_role_name),
# 51-pod-roles 의 ESO Role(var.external_secrets_role_name)이다.
# 고정 이름으로 ARN 을 만들므로 60 · 70 과 의존 관계가 없다.

locals {
  secret_prefix = "${var.project}/${var.environment}"

  secrets = {
    github_app = {
      name        = "${local.secret_prefix}/github-app"
      description = "GitHub App for gitops release PRs (contents, pull_requests write on gitops repo only)"
      readers     = [var.release_role_name]
    }
    toss_payments = {
      name        = "${local.secret_prefix}/toss-payments"
      description = "Toss Payments secret key (TOSS_SECRET_KEY) for payment servers"
      readers     = [var.payment_app_role_name]
    }
    seed_admin = {
      name        = "${local.secret_prefix}/seed-admin"
      description = "Seed admin account (SEED_ADMIN_*) for the backend seed Job"
      readers     = [var.external_secrets_role_name]
    }
    grafana_admin = {
      name        = "${local.secret_prefix}/grafana-admin"
      description = "Grafana admin account for the main cluster kube-prometheus-stack"
      readers     = [var.external_secrets_role_name]
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

resource "aws_secretsmanager_secret_version" "github_app" {
  secret_id = aws_secretsmanager_secret.this["github_app"].id

  secret_string_wo = jsonencode({
    app_id          = var.github_app_id
    installation_id = var.github_app_installation_id
    private_key     = var.github_app_private_key
  })
  secret_string_wo_version = var.github_app_credentials_version
}

resource "aws_secretsmanager_secret_version" "toss_payments" {
  secret_id = aws_secretsmanager_secret.this["toss_payments"].id

  secret_string_wo         = jsonencode({ secret_key = var.toss_secret_key })
  secret_string_wo_version = var.toss_credentials_version
}

resource "aws_secretsmanager_secret_version" "seed_admin" {
  secret_id = aws_secretsmanager_secret.this["seed_admin"].id

  secret_string_wo = jsonencode({
    email    = var.seed_admin_email
    password = var.seed_admin_password
    name     = var.seed_admin_name
  })
  secret_string_wo_version = var.seed_admin_credentials_version
}

# 로그인 이름은 고정(admin), 비밀번호만 사람이 정한다
resource "aws_secretsmanager_secret_version" "grafana_admin" {
  secret_id = aws_secretsmanager_secret.this["grafana_admin"].id

  secret_string_wo = jsonencode({
    admin_user     = "admin"
    admin_password = var.grafana_admin_password
  })
  secret_string_wo_version = var.grafana_admin_credentials_version
}

# 값 조회(GetSecretValue)는 Secret 별 읽는 Role(readers)과 관리자(이 스택을 apply 하는 주체)만 허용한다 (41-main-data 와 같은 방식).
# 공유 계정이라 관리자 ARN 을 레포에 적지 않고 실행 주체에서 읽는다. 계정 자리를 * 로 두지 않는다 (최소 권한)
data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

# github-app 은 release.yml 릴리스 Role 만, 토스 시크릿 키는 결제 서버만, 시드 관리자 · Grafana admin 계정은 ESO 만 읽는다
data "aws_iam_policy_document" "secret" {
  for_each = local.secrets

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
      values = concat(
        [for r in each.value.readers : "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${r}"],
        [data.aws_iam_session_context.current.issuer_arn],
      )
    }
  }
}

resource "aws_secretsmanager_secret_policy" "this" {
  for_each = aws_secretsmanager_secret.this

  secret_arn          = each.value.arn
  policy              = data.aws_iam_policy_document.secret[each.key].json
  block_public_policy = true
}
