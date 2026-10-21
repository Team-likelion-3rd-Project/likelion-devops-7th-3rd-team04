# 메인 DB (hotel_service). user · auth · hotel · booking 서비스가 같이 쓰고, 테이블은 Flyway(backend/migrations) 가 만든다.
# 배포 전에는 앱 · Flyway 모두 master 계정을 쓴다. 배포 후 IAM 인증 전환 시 master 는 마이그레이션 Job 만 쓴다.

resource "aws_db_subnet_group" "main" {
  name        = "${local.name}-db"
  description = "Main RDS MariaDB"
  subnet_ids  = var.db_subnet_ids
}

resource "aws_db_parameter_group" "main" {
  name        = "${local.name}-mariadb${replace(var.db_engine_version, ".", "-")}"
  description = "Main RDS MariaDB"
  family      = "mariadb${var.db_engine_version}"

  # MariaDB 11.8 은 기본값이 1 이다. 기본값과 같은 값을 넣으면 AWS 가 apply_method 를 pending-reboot 로 돌려줘
  # immediate(provider 기본값) 로 두면 매 plan 마다 차이가 생긴다. 인스턴스 생성 시 붙으므로 재생성 환경에서는 동작 차이 없음
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

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
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

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.sg_ids["main_db"]]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false
  multi_az               = var.db_multi_az

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
}
