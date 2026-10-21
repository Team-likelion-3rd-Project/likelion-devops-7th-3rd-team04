import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CHAT_SESSIONS_TABLE,
  DYNAMODB_CLIENT,
} from '../dynamodb/dynamodb.constants';

export interface ChatSession {
  sessionId: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
}

// 로그인 사용자 1명당 세션 1개(v1)만 유지합니다. userId-index GSI로 기존 세션을 찾고
// 없으면 새로 만듭니다 — ChatGPT식 다중 세션 목록은 이후 확장 대상입니다.
@Injectable()
export class SessionService {
  constructor(
    @Inject(DYNAMODB_CLIENT)
    private readonly docClient: DynamoDBDocumentClient,
  ) {}

  async getOrCreateSession(userId: number): Promise<ChatSession> {
    const existing = await this.findByUserId(userId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const session: ChatSession = {
      sessionId: randomUUID(),
      userId,
      createdAt: now,
      updatedAt: now,
    };

    await this.docClient.send(
      new PutCommand({ TableName: CHAT_SESSIONS_TABLE, Item: session }),
    );

    return session;
  }

  // 이력 조회 전용 — 세션이 없어도 새로 만들지 않고 null을 반환합니다.
  async findByUserId(userId: number): Promise<ChatSession | null> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: CHAT_SESSIONS_TABLE,
        IndexName: 'userId-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        Limit: 1,
      }),
    );

    const item = result.Items?.[0] as ChatSession | undefined;
    return item ?? null;
  }
}
