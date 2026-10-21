# 다른 스택은 dependency.payment_data.outputs.<이름> 처럼 읽는다.
# 비밀번호는 write-only 라 output 할 수 없다. 결제 서버는 Secret 을 읽는다.
# 계정 ID 가 로그에 찍히지 않도록 ARN 은 output 하지 않는다. IAM 정책에서는 이름으로 ARN 패턴을 만든다
#   Secret : arn:aws:secretsmanager:<리전>:<계정>:secret:<이름>-*  (ARN 끝에 무작위 6자가 붙음)

output "db_endpoint" {
  description = "결제 RDS MariaDB 주소 (PAYMENT_DB_HOST)"
  value       = aws_db_instance.payment.address
}

output "db_port" {
  description = "결제 RDS MariaDB 포트 (PAYMENT_DB_PORT)"
  value       = aws_db_instance.payment.port
}

output "db_name" {
  description = "결제 데이터베이스 이름 (PAYMENT_DB_DATABASE)"
  value       = aws_db_instance.payment.db_name
}

output "secret_name" {
  description = "결제 DB 접속 정보 Secret 이름"
  value       = aws_secretsmanager_secret.payment_db.name
}
