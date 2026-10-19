# 다른 스택은 dependency.main_data.outputs.<이름> 처럼 읽는다.
# 비밀값(DB 비밀번호 · Valkey 토큰)은 write-only 라 output 할 수 없다. 앱은 Secret 을 ESO 로 읽는다.
# 계정 ID 가 로그에 찍히지 않도록 ARN 은 output 하지 않는다. IAM 정책에서는 이름으로 ARN 패턴을 만든다
#   Secret   : arn:aws:secretsmanager:<리전>:<계정>:secret:<이름>-*  (ARN 끝에 무작위 6자가 붙음)
#   DynamoDB : arn:aws:dynamodb:<리전>:<계정>:table/<이름>, GSI 는 .../index/*

output "db_endpoint" {
  description = "RDS MariaDB 주소 (DB_HOST)"
  value       = aws_db_instance.main.address
}

output "db_port" {
  description = "RDS MariaDB 포트 (DB_PORT)"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "메인 데이터베이스 이름 (DB_DATABASE)"
  value       = aws_db_instance.main.db_name
}

output "valkey_endpoint" {
  description = "Valkey primary 엔드포인트 (REDIS_HOST)"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "valkey_port" {
  description = "Valkey 포트 (REDIS_PORT)"
  value       = aws_elasticache_replication_group.main.port
}

output "secret_names" {
  description = "접속 정보 Secret 이름 (main_db, main_valkey). ESO ExternalSecret 의 remoteRef.key"
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.name }
}

output "dynamodb_table_names" {
  description = "DynamoDB 테이블 이름 (chat_sessions, chat_messages). DYNAMODB_CHAT_SESSIONS_TABLE · DYNAMODB_CHAT_MESSAGES_TABLE"
  value = {
    chat_sessions = aws_dynamodb_table.chat_sessions.name
    chat_messages = aws_dynamodb_table.chat_messages.name
  }
}
