# Main VPC 서비스 데이터 계층: RDS MariaDB, ElastiCache Valkey, DynamoDB 채팅 테이블, 접속 정보 · 앱 서명 키 Secret.
#
#   파드 → (워커 노드 IP, Calico natOutgoing) → RDS 3306 · Valkey 6379   SG: 30-security main_db(M11) · main_valkey(M12)
#   파드 → DynamoDB 게이트웨이 엔드포인트(20-network)
#
# 비밀값은 state 에 남기지 않는다.
#   ephemeral 리소스로 실행마다 비밀번호를 만들고, write-only 속성(*_wo)으로 RDS · Valkey · Secret 에 같은 값을 넣는다.
#   write-only 값은 생성 시와 *_wo_version(credentials_version) 이 바뀔 때만 전달되므로
#   셋을 이 스택 하나에 묶고 같은 version 변수를 쓴다. 다른 스택으로 output 할 수 없다.
#   앱은 고정 이름 Secret(team04-hotel/prod/main-db · main-valkey · backend-app) 을 ESO 로 읽는다.

locals {
  name = "${var.project}-main"

  secret_prefix = "${var.project}/${var.environment}"
}

# 영숫자만 쓴다. RDS 는 / @ " 공백, Valkey AUTH 는 @ " / 등을 허용하지 않는다
ephemeral "aws_secretsmanager_random_password" "db" {
  password_length            = 32
  exclude_punctuation        = true
  require_each_included_type = true
}

ephemeral "aws_secretsmanager_random_password" "valkey" {
  password_length            = 64
  exclude_punctuation        = true
  require_each_included_type = true
}
