# Payment VPC 데이터 계층: 결제 RDS MariaDB, 접속 정보 Secret.
#
#   결제 앱(payment-service · Flyway) → RDS 3306   SG: 30-security payment_app → payment_db (P3)
#   결제 앱 → Secrets Manager 인터페이스 엔드포인트(44-payment-endpoints) → team04-hotel/prod/payment-db
#
# 비밀값은 state 에 남기지 않는다 (41-main-data 와 같은 방식).
#   ephemeral 리소스로 실행마다 비밀번호를 만들고, write-only 속성(*_wo)으로 RDS · Secret 에 같은 값을 넣는다.
#   write-only 값은 생성 시와 credentials_version 이 바뀔 때만 전달되므로 둘을 이 스택 하나에 묶는다.
#   결제 서버는 고정 이름 Secret(payment-db · payment-db-exporter) 을 인스턴스 Role 로 읽는다 (60-payment-app).

locals {
  name = "${var.project}-payment"

  secret_prefix = "${var.project}/${var.environment}"

  # RDS → CloudWatch Logs /aws/rds/instance/<식별자>/<종류> (LDP-180)
  db_log_exports = ["error", "slowquery"]
}

# 영숫자만 쓴다. RDS 는 / @ " 공백을 허용하지 않는다
ephemeral "aws_secretsmanager_random_password" "db" {
  password_length            = 32
  exclude_punctuation        = true
  require_each_included_type = true
}

# mysqld_exporter 계정 (LDP-181). 계정은 결제 서버가 부팅 때 master 로 만든다 (secrets.tf, 60 payment-metrics-setup)
ephemeral "aws_secretsmanager_random_password" "db_exporter" {
  password_length            = 32
  exclude_punctuation        = true
  require_each_included_type = true
}
