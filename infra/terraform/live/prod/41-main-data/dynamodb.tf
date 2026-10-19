# chat-bot-service 대화 세션 · 메시지 테이블. 키 스키마는 backend/scripts/dynamodb-init.ts (로컬 전용 생성 스크립트) 와 같다.
# 공유 계정이라 이름에 프로젝트 접두사를 붙인다. 앱은 DYNAMODB_CHAT_SESSIONS_TABLE · DYNAMODB_CHAT_MESSAGES_TABLE 로 받는다.
# server_side_encryption 을 켜면 AWS 관리형 키(aws/dynamodb)로 암호화한다 (끄면 AWS 소유 키).

# PK sessionId, GSI userId-index (로그인 사용자 1명당 세션 1개 get-or-create)
resource "aws_dynamodb_table" "chat_sessions" {
  name         = "${var.project}-ChatSessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sessionId"

  attribute {
    name = "sessionId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "N"
  }

  global_secondary_index {
    name            = "userId-index"
    projection_type = "ALL"

    key_schema {
      attribute_name = "userId"
      key_type       = "HASH"
    }
  }

  server_side_encryption {
    enabled = true
  }

  # 매일 재생성
  deletion_protection_enabled = false
}

# PK sessionId + SK messageId(createdAt#uuid), 세션별 대화 이력 시간순 조회
resource "aws_dynamodb_table" "chat_messages" {
  name         = "${var.project}-ChatMessages"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sessionId"
  range_key    = "messageId"

  attribute {
    name = "sessionId"
    type = "S"
  }

  attribute {
    name = "messageId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  deletion_protection_enabled = false
}
