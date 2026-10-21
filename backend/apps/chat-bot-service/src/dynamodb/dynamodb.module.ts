import { Module } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DYNAMODB_CLIENT } from './dynamodb.constants';

// chat-bot-service가 세션/대화 이력을 저장하는 DynamoDB 클라이언트를 등록합니다.
// 로컬 개발: docker-compose의 dynamodb-local 컨테이너 (DYNAMODB_ENDPOINT=http://dynamodb-local:8000).
//   DynamoDB Local은 자격 증명을 검증하지 않지만 SDK가 서명을 위해 값 자체는 요구하므로,
//   아래에서 AWS_ACCESS_KEY_ID/SECRET이 없으면 'local'로 기본값을 채웁니다 — 별도로
//   env var를 설정할 필요 없이 이 파일 자체가 로컬 더미값을 보장합니다.
// 운영: 실제 AWS DynamoDB (DYNAMODB_ENDPOINT 미설정 → SDK 기본 리전 엔드포인트 사용, 인증은
//   EKS pod identity(chatbot_service IAM 역할)로 처리되므로 access key 불필요).
// Redis/ElastiCache와 마찬가지로 엔드포인트만 바뀌는 것이므로 이 파일은 그대로 두고 env var만 교체하면 됩니다.
@Module({
  providers: [
    {
      provide: DYNAMODB_CLIENT,
      useFactory: (): DynamoDBDocumentClient => {
        const endpoint = process.env.DYNAMODB_ENDPOINT || undefined;

        const client = new DynamoDBClient({
          region: process.env.DYNAMODB_REGION || 'ap-northeast-2',
          endpoint,
          // endpoint가 있을 때(=로컬 DynamoDB Local)만 더미 자격 증명을 명시합니다.
          // 운영에서는 endpoint가 없으므로 SDK 기본 자격 증명 체인(pod identity)을 그대로 씁니다.
          ...(endpoint
            ? {
                credentials: {
                  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
                  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
                },
              }
            : {}),
        });

        return DynamoDBDocumentClient.from(client, {
          marshallOptions: { removeUndefinedValues: true },
        });
      },
    },
  ],
  exports: [DYNAMODB_CLIENT],
})
export class DynamoDbModule {}
