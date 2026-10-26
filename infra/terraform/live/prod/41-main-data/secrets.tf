# 앱 접속 정보 Secret. 이름이 고정이라 재생성 후에도 ESO ExternalSecret 이 같은 이름으로 읽는다.
# RDS 관리형 Secret(manage_master_user_password) 은 이름이 무작위라 쓰지 않는다.
#
#   team04-hotel/prod/main-db     : {engine, host, port, dbname, username, password}  → DB_HOST · DB_PORT · DB_DATABASE · DB_USERNAME · DB_PASSWORD
#   team04-hotel/prod/main-valkey : {host, port, password}                            → REDIS_HOST · REDIS_PORT · REDIS_PASSWORD
#   team04-hotel/prod/backend-app : {jwt_access_secret, jwt_refresh_secret, mock_pg_secret, n8n_owner_password}
#                                   → JWT_ACCESS_SECRET · JWT_REFRESH_SECRET · MOCK_PG_SECRET · N8N_INIT_OWNER_PASSWORD
#
# backend-app 은 DB · Valkey 와 상관없는 앱 서명 키다. 매일 재생성 때 새로 만들어지므로 그날 발급한 토큰은 다음 재생성 후 무효가 된다.
# MOCK_PG_SECRET 은 prod 에서 쓰지 않는 pg-mock 웹훅(api-gateway /api/payments/webhook)의 HMAC 키다.
# 비우면 앱이 공개된 기본값으로 검증하므로 무작위 값을 넣어 위조 요청을 막는다.
# n8n_owner_password 는 n8n 워크플로 활성화용 내부 owner 계정이다 (사람이 로그인하지 않으므로 매일 새 값이어도 된다).
#
# 값은 secret_string_wo 라 state 에 남지 않는다. DB · Valkey 와 같은 실행에서 같은 ephemeral 값을 넣는다.
# DB · Valkey 가 교체되면(새 비밀번호로 생성) Secret 값도 같은 실행에서 다시 넣도록 replace_triggered_by 를 건다.

locals {
  secrets = {
    main_db = {
      name        = "${local.secret_prefix}/main-db"
      description = "Main RDS MariaDB connection (master)"
    }
    main_valkey = {
      name        = "${local.secret_prefix}/main-valkey"
      description = "Main ElastiCache Valkey connection (AUTH token)"
    }
    backend_app = {
      name        = "${local.secret_prefix}/backend-app"
      description = "Backend app signing keys (JWT, mock PG webhook HMAC), n8n owner password"
    }
  }
}

# HMAC 키라 길이만 충분하면 된다 (HS256 은 32바이트 이상 권장).
# n8n 비밀번호 규칙은 8 – 64자, 대문자 · 숫자 포함 (require_each_included_type 로 충족)
ephemeral "aws_secretsmanager_random_password" "backend_app" {
  for_each = {
    jwt_access_secret  = 64
    jwt_refresh_secret = 64
    mock_pg_secret     = 64
    n8n_owner_password = 32
  }

  password_length            = each.value
  exclude_punctuation        = true
  require_each_included_type = true
}

resource "aws_secretsmanager_secret" "this" {
  for_each = local.secrets

  name        = each.value.name
  description = each.value.description

  # 매일 재생성 (README 5절). 0 이 아니면 같은 이름으로 다시 만들 수 없다
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "main_db" {
  secret_id = aws_secretsmanager_secret.this["main_db"].id

  secret_string_wo = jsonencode({
    engine   = "mariadb"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
    username = aws_db_instance.main.username
    password = ephemeral.aws_secretsmanager_random_password.db.random_password
  })
  secret_string_wo_version = var.credentials_version

  lifecycle {
    replace_triggered_by = [aws_db_instance.main.id]
  }
}

resource "aws_secretsmanager_secret_version" "main_valkey" {
  secret_id = aws_secretsmanager_secret.this["main_valkey"].id

  secret_string_wo = jsonencode({
    host     = aws_elasticache_replication_group.main.primary_endpoint_address
    port     = aws_elasticache_replication_group.main.port
    password = ephemeral.aws_secretsmanager_random_password.valkey.random_password
  })
  secret_string_wo_version = var.credentials_version

  lifecycle {
    replace_triggered_by = [aws_elasticache_replication_group.main.id]
  }
}

resource "aws_secretsmanager_secret_version" "backend_app" {
  secret_id = aws_secretsmanager_secret.this["backend_app"].id

  secret_string_wo = jsonencode({
    for k, p in ephemeral.aws_secretsmanager_random_password.backend_app : k => p.random_password
  })
  secret_string_wo_version = var.credentials_version
}

# 값 조회(GetSecretValue)는 ESO Role 과 관리자(이 스택을 apply 하는 주체)만 허용한다.
# IAM 정책으로 권한을 받은 다른 주체도 리소스 정책의 Deny 가 우선한다.
# 공유 계정이라 관리자 ARN 을 레포에 적지 않고 실행 주체에서 읽는다 (assume role 이면 세션이 아닌 Role ARN).
# 계정 자리를 * 로 두지 않는다 (최소 권한). 정책 diff 에 계정 ID 가 찍히므로 로그는 로컬에만 두고 CI 에서는 마스킹한다.
data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

locals {
  secret_reader_arns = [
    "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${var.external_secrets_role_name}",
    data.aws_iam_session_context.current.issuer_arn,
  ]
}

data "aws_iam_policy_document" "secret" {
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
      values   = local.secret_reader_arns
    }
  }
}

resource "aws_secretsmanager_secret_policy" "this" {
  for_each = aws_secretsmanager_secret.this

  secret_arn          = each.value.arn
  policy              = data.aws_iam_policy_document.secret.json
  block_public_policy = true
}
