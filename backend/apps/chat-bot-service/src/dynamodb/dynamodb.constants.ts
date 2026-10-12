export const DYNAMODB_CLIENT = 'DYNAMODB_CLIENT';

// 실제 테이블은 infra/terraform으로 프로비저닝됩니다 — 이름을 바꿔야 하면 코드 대신 env var로 덮어씁니다.
export const CHAT_SESSIONS_TABLE =
  process.env.DYNAMODB_CHAT_SESSIONS_TABLE || 'ChatSessions';
export const CHAT_MESSAGES_TABLE =
  process.env.DYNAMODB_CHAT_MESSAGES_TABLE || 'ChatMessages';
