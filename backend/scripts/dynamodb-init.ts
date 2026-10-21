import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';

// docker compose 기동 시(dynamodb-init 서비스, scripts/Dockerfile.seed 재사용) 1회 실행되는
// DynamoDB 테이블 부트스트랩 스크립트입니다. chat-bot-service의 session/message.service.ts가
// 이미 존재한다고 가정하는 ChatSessions/ChatMessages 테이블을, DynamoDB Local이 완전히 빈
// 상태로 뜨기 때문에 여기서 만들어줍니다. 운영(AWS DynamoDB)에서는 infra/terraform으로
// 프로비저닝하므로 이 스크립트는 로컬 개발 전용입니다.
// 매번 재실행해도 안전하도록(멱등) 이미 존재하는 테이블은 건너뜁니다.

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const DYNAMODB_REGION = process.env.DYNAMODB_REGION ?? 'ap-northeast-2';

// 테이블 이름은 apps/chat-bot-service/src/dynamodb/dynamodb.constants.ts와 동일한
// env var로 덮어쓸 수 있게 맞춰둡니다.
const CHAT_SESSIONS_TABLE =
  process.env.DYNAMODB_CHAT_SESSIONS_TABLE ?? 'ChatSessions';
const CHAT_MESSAGES_TABLE =
  process.env.DYNAMODB_CHAT_MESSAGES_TABLE ?? 'ChatMessages';

// DynamoDB Local은 자격 증명을 검증하지 않지만 SDK가 서명을 위해 값 자체는 요구하므로,
// AWS_ACCESS_KEY_ID/SECRET이 없으면 'local'로 기본값을 채웁니다(dynamodb.module.ts와 동일) —
// 별도로 env var를 설정할 필요 없이 이 파일 자체가 로컬 더미값을 보장합니다.
const client = new DynamoDBClient({
  region: DYNAMODB_REGION,
  endpoint: DYNAMODB_ENDPOINT || undefined,
  ...(DYNAMODB_ENDPOINT
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
        },
      }
    : {}),
});

// dynamodb-local 컨테이너에는 healthcheck가 없어서(docker-compose.yml), 뜬 직후엔 아직
// 연결을 안 받을 수 있습니다 — seed.ts의 createDataSourceWithRetry와 같은 이유로 재시도합니다.
async function listExistingTablesWithRetry(
  maxAttempts = 5,
  delayMs = 2000,
): Promise<string[]> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await client.send(new ListTablesCommand({}));
      return result.TableNames ?? [];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[dynamodb-init] DynamoDB 연결 실패 (${attempt}/${maxAttempts}): ${message}`,
      );
      if (attempt === maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('unreachable');
}

async function createTableIfMissing(
  existingTables: string[],
  tableName: string,
  keySchema: NonNullable<CreateTableCommand['input']['KeySchema']>,
  attributeDefinitions: NonNullable<
    CreateTableCommand['input']['AttributeDefinitions']
  >,
  globalSecondaryIndexes?: CreateTableCommand['input']['GlobalSecondaryIndexes'],
): Promise<void> {
  if (existingTables.includes(tableName)) {
    console.log(
      `[dynamodb-init] ${tableName} 테이블이 이미 존재합니다 — 건너뜁니다.`,
    );
    return;
  }

  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: keySchema,
        AttributeDefinitions: attributeDefinitions,
        GlobalSecondaryIndexes: globalSecondaryIndexes,
      }),
    );
    console.log(`[dynamodb-init] ${tableName} 테이블 생성 완료`);
  } catch (err) {
    // 동시에 여러 번 실행돼 레이스가 나도(멱등) 그냥 넘어갑니다.
    if (err instanceof ResourceInUseException) {
      console.log(
        `[dynamodb-init] ${tableName} 테이블이 이미 생성 중/완료 상태입니다 — 건너뜁니다.`,
      );
      return;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const existingTables = await listExistingTablesWithRetry();

  // ChatSessions: PK sessionId, GSI userId-index (userId → sessionId 조회용, 로그인
  // 사용자 1명당 세션 1개를 찾는 get-or-create에 사용).
  await createTableIfMissing(
    existingTables,
    CHAT_SESSIONS_TABLE,
    [{ AttributeName: 'sessionId', KeyType: 'HASH' }],
    [
      { AttributeName: 'sessionId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'N' },
    ],
    [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  );

  // ChatMessages: PK sessionId + SK messageId(createdAt#uuid) — 세션별 대화 이력 시간순 조회용.
  await createTableIfMissing(
    existingTables,
    CHAT_MESSAGES_TABLE,
    [
      { AttributeName: 'sessionId', KeyType: 'HASH' },
      { AttributeName: 'messageId', KeyType: 'RANGE' },
    ],
    [
      { AttributeName: 'sessionId', AttributeType: 'S' },
      { AttributeName: 'messageId', AttributeType: 'S' },
    ],
  );

  console.log('[dynamodb-init] 부트스트랩 완료');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[dynamodb-init] 부트스트랩 실패:', err);
    process.exit(1);
  });
