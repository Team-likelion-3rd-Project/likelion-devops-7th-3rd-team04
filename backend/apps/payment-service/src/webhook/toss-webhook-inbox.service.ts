import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { PgWebhookInbox } from '../entities/pg-webhook-inbox.entity';
import { isDuplicateKeyError } from '../payment-service.service';

const PAYMENT_STATUS_CHANGED = 'PAYMENT_STATUS_CHANGED';

// Lambda가 큐에 넣는 메시지 (infra/terraform/live/prod/50-payment-webhook/lambda/index.mjs)
export interface TossWebhookMessage {
  headers?: Record<string, unknown>;
  body: {
    eventType?: string;
    data?: { paymentKey?: string; orderId?: string; status?: string };
  };
}

// 토스 웹훅 원본을 pg_webhook_inbox에 저장한다. 판단은 하지 않고, 대사 배치가 토스 재조회로 검증해 처리한다.
@Injectable()
export class TossWebhookInboxService {
  constructor(
    @InjectRepository(PgWebhookInbox)
    private readonly inboxRepository: Repository<PgWebhookInbox>,
  ) {}

  async record({ headers, body }: TossWebhookMessage): Promise<void> {
    if (body.eventType !== PAYMENT_STATUS_CHANGED) {
      return;
    }
    const { paymentKey, status } = body.data ?? {};
    if (!paymentKey || !status) {
      // 지우면 웹훅을 잃으므로 실패로 돌려 DLQ로 가게 한다
      throw new Error('토스 웹훅에 paymentKey 또는 status가 없습니다.');
    }
    try {
      await this.inboxRepository.insert({
        // tosspayments-webhook-transmission-id는 재전송마다 바뀌어 중복 판별에 쓸 수 없다
        pgEventKey: `toss:${paymentKey}:${status}`,
        eventType: body.eventType,
        headers: headers ?? null,
        body,
      } as QueryDeepPartialEntity<PgWebhookInbox>);
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error, 'uk_pg_webhook_inbox_pg_event_key')) {
        throw error;
      }
    }
  }
}
