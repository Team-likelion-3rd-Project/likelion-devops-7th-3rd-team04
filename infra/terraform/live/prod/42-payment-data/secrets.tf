# 결제 DB 접속 정보 Secret. 이름이 고정이라 재생성 후에도 결제 서버가 같은 이름으로 읽는다.
#
#   team04-hotel/prod/payment-db : {engine, host, port, dbname, username, password}
#                                  → PAYMENT_DB_HOST · PAYMENT_DB_PORT · PAYMENT_DB_DATABASE · PAYMENT_DB_USERNAME · PAYMENT_DB_PASSWORD
#   team04-hotel/prod/payment-db-exporter : {host, port, username, password}
#                                  → 결제 서버 Alloy mysqld_exporter (LDP-181). 계정은 DB 에 없고 결제 서버가 부팅 때 만든다
#
# 값은 secret_string_wo 라 state 에 남지 않는다. RDS 와 같은 실행에서 같은 ephemeral 값을 넣는다.
# RDS 가 교체되면(새 비밀번호로 생성) Secret 값도 같은 실행에서 다시 넣도록 replace_triggered_by 를 건다.

resource "aws_secretsmanager_secret" "payment_db" {
  name        = "${local.secret_prefix}/payment-db"
  description = "Payment RDS MariaDB connection (master)"

  # 매일 재생성 (README 5절). 0 이 아니면 같은 이름으로 다시 만들 수 없다
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "payment_db" {
  secret_id = aws_secretsmanager_secret.payment_db.id

  secret_string_wo = jsonencode({
    engine   = "mariadb"
    host     = aws_db_instance.payment.address
    port     = aws_db_instance.payment.port
    dbname   = aws_db_instance.payment.db_name
    username = aws_db_instance.payment.username
    password = ephemeral.aws_secretsmanager_random_password.db.random_password
  })
  secret_string_wo_version = var.credentials_version

  lifecycle {
    replace_triggered_by = [aws_db_instance.payment.id]
  }
}

resource "aws_secretsmanager_secret" "payment_db_exporter" {
  name        = "${local.secret_prefix}/payment-db-exporter"
  description = "Payment RDS MariaDB mysqld_exporter account"

  recovery_window_in_days = 0
}

# 계정 생성 단계(60 payment-metrics-setup)가 부팅마다 ALTER USER 로 이 비밀번호를 다시 넣으므로,
# DB 가 교체되어도 Secret 을 다시 쓸 필요가 없다 (주소는 식별자가 고정이라 같다. 41-main-data 와 같은 방식)
resource "aws_secretsmanager_secret_version" "payment_db_exporter" {
  secret_id = aws_secretsmanager_secret.payment_db_exporter.id

  secret_string_wo = jsonencode({
    host     = aws_db_instance.payment.address
    port     = aws_db_instance.payment.port
    username = var.db_exporter_username
    password = ephemeral.aws_secretsmanager_random_password.db_exporter.random_password
  })
  secret_string_wo_version = var.credentials_version
}

# 값 조회(GetSecretValue)는 결제 서버 Role 과 관리자(이 스택을 apply 하는 주체)만 허용한다.
# IAM 정책으로 권한을 받은 다른 주체도 리소스 정책의 Deny 가 우선한다.
# 공유 계정이라 관리자 ARN 을 레포에 적지 않고 실행 주체에서 읽는다 (assume role 이면 세션이 아닌 Role ARN).
# 계정 자리를 * 로 두지 않는다 (최소 권한). 정책 diff 에 계정 ID 가 찍히므로 로그는 로컬에만 두고 CI 에서는 마스킹한다.
data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

data "aws_iam_policy_document" "payment_db_secret" {
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
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${var.payment_app_role_name}",
        data.aws_iam_session_context.current.issuer_arn,
      ]
    }
  }
}

resource "aws_secretsmanager_secret_policy" "payment_db" {
  for_each = {
    payment_db          = aws_secretsmanager_secret.payment_db.arn
    payment_db_exporter = aws_secretsmanager_secret.payment_db_exporter.arn
  }

  secret_arn          = each.value
  policy              = data.aws_iam_policy_document.payment_db_secret.json
  block_public_policy = true
}

# 기존 단일 리소스 → for_each (주소만 옮김, 정책은 그대로)
moved {
  from = aws_secretsmanager_secret_policy.payment_db
  to   = aws_secretsmanager_secret_policy.payment_db["payment_db"]
}
