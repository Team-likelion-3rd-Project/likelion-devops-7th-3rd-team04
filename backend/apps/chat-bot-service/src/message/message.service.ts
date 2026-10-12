import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CHAT_MESSAGES_TABLE,
  DYNAMODB_CLIENT,
} from '../dynamodb/dynamodb.constants';

export type ChatRole = 'USER' | 'ASSISTANT';

export interface ChatMessageItem {
  sessionId: string;
  // createdAt 접두 정렬키 — createdAt만 쓰면 동시 기록 시 값이 겹칠 수 있어 uuid를 덧붙입니다.
  messageId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

const DEFAULT_HISTORY_LIMIT = 20;

@Injectable()
export class MessageService {
  constructor(
    @Inject(DYNAMODB_CLIENT)
    private readonly docClient: DynamoDBDocumentClient,
  ) {}

  async appendMessage(
    sessionId: string,
    role: ChatRole,
    content: string,
  ): Promise<ChatMessageItem> {
    const createdAt = new Date().toISOString();
    const item: ChatMessageItem = {
      sessionId,
      messageId: `${createdAt}#${randomUUID()}`,
      role,
      content,
      createdAt,
    };

    await this.docClient.send(
      new PutCommand({ TableName: CHAT_MESSAGES_TABLE, Item: item }),
    );

    return item;
  }

  // 최근 메시지 최대 limit개를 오래된순으로 반환합니다 (n8n 대화 context 및 이력 조회 응답용).
  async getRecentMessages(
    sessionId: string,
    limit: number = DEFAULT_HISTORY_LIMIT,
  ): Promise<ChatMessageItem[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: CHAT_MESSAGES_TABLE,
        KeyConditionExpression: 'sessionId = :sessionId',
        ExpressionAttributeValues: { ':sessionId': sessionId },
        ScanIndexForward: false, // messageId(=createdAt 접두) 내림차순 → 최신 limit개
        Limit: limit,
      }),
    );

    const items = (result.Items ?? []) as ChatMessageItem[];
    return items.reverse(); // 오래된순으로 뒤집어 반환
  }
}
