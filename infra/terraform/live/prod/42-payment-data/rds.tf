# 결제 DB (payment_db). payment-service 만 쓰고, 테이블은 Flyway(backend/apps/payment-service/migrations) 가 만든다.
# 배포 전에는 앱 · Flyway 모두 master 계정을 쓴다 (41-main-data 와 같음).

resource "aws_db_subnet_group" "payment" {
  name        = "${local.name}-db"
  description = "Payment RDS MariaDB"
  subnet_ids  = var.db_subnet_ids
}

resource "aws_db_parameter_group" "payment" {
  name        = "${local.name}-mariadb${replace(var.db_engine_version, ".", "-")}"
  description = "Payment RDS MariaDB"
  family      = "mariadb${var.db_engine_version}"

  # MariaDB 11.8 은 기본값이 1 이다. apply_method 를 pending-reboot 로 두지 않으면 매 plan 마다 차이가 생긴다 (41-main-data rds.tf)
  parameter {
    name         = "require_secure_transport"
    value        = var.db_require_secure_transport ? "1" : "0"
    apply_method = "pending-reboot"
  }

  # 테이블은 Flyway 가 utf8mb4 로 만든다. 접속 · 새 DB 기본값도 맞춘다
  parameter {
    name  = "character_set_server"
    value = "utf8mb4"
  }

  parameter {
    name  = "collation_server"
    value = "utf8mb4_general_ci"
  }

  # 슬로우 · 에러 로그 → CloudWatch Logs (LDP-180, 이름 · log_output 이유는 41-main-data rds.tf)
  parameter {
    name  = "log_output"
    value = "FILE"
  }

  parameter {
    name  = "log_slow_query"
    value = "1"
  }

  parameter {
    name  = "log_slow_query_time"
    value = tostring(var.db_slow_query_seconds)
  }

  parameter {
    name  = "innodb_print_all_deadlocks"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# RDS 가 만들기 전에 먼저 만든다 (보관 기간, destroy 때 삭제). DB 가 depends_on 하므로 destroy 는 DB → 그룹 순서
resource "aws_cloudwatch_log_group" "db" {
  for_each = toset(local.db_log_exports)

  name              = "/aws/rds/instance/${local.name}/${each.key}"
  retention_in_days = var.db_log_retention_days
}

resource "aws_db_instance" "payment" {
  identifier = local.name

  engine         = "mariadb"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name             = var.db_name
  username            = var.db_master_username
  password_wo         = ephemeral.aws_secretsmanager_random_password.db.random_password
  password_wo_version = var.credentials_version

  db_subnet_group_name   = aws_db_subnet_group.payment.name
  vpc_security_group_ids = [var.sg_ids["payment_db"]]
  parameter_group_name   = aws_db_parameter_group.payment.name
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  enabled_cloudwatch_logs_exports = local.db_log_exports

  backup_retention_period  = var.db_backup_retention_days
  delete_automated_backups = true
  copy_tags_to_snapshot    = true

  auto_minor_version_upgrade = true
  apply_immediately          = true

  # 매일 재생성 (README 5절)
  skip_final_snapshot = true
  deletion_protection = false

  tags = {
    Name = local.name
  }

  depends_on = [aws_cloudwatch_log_group.db]
}
