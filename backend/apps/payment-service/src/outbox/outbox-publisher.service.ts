import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { SQS_CLIENT, paymentResultQueueUrl } from '@app/common';

// 한 번에 가져와 보낼 최대 행 수 (SQS SendMessageBatch 한도 10)
const BATCH_SIZE = 10;
// 보낼 게 없을 때 다음 확인까지 기다리는 시간. 결제 후 1초 안에 예약이 확정되도록(이슈 #39 완료 조건) 짧게 둡니다.
const DEFAULT_POLL_INTERVAL_MS = 500;
// DB·큐 오류가 났을 때 다시 시도하기 전 기다리는 시간
const ERROR_BACKOFF_MS = 3000;
// 가져간 행을 맡아 두는 시간 (lease). 보내는 도중 죽어도 이 시간이 지나면 다른 발행기가 다시 가져간다.
// SQS 호출 기한(5초, 재시도 포함)보다 넉넉하게.
const LEASE_SECONDS = 30;

interface OutboxRow {
  event_id: string;
  reservation_id: number;
  payload: string | Record<string, unknown>;
}

// Outbox 발행기 (Transactional Outbox 패턴의 "보내는 쪽").
// payment_outbox 에서 아직 안 보낸 행(published_at IS NULL)을 꺼내 결제 결과 큐(SQS FIFO / ElasticMQ)로
// 보내고, 성공한 행에 published_at 을 기록합니다.
//
//  - 가져가기(짧은 트랜잭션) → 보내기(트랜잭션 밖) → 기록(짧은 트랜잭션) 세 단계로 나눕니다 (LDP-97).
//    예전에는 행 잠금(FOR UPDATE)을 쥔 채 큐로 보내서, 큐가 느리면 결제 승인 기록(outbox INSERT)까지 기다릴 수 있었습니다.
//    지금은 가져갈 때 locked_until(lease)만 찍고 바로 커밋하므로, 큐를 기다리는 동안 아무것도 잠그지 않습니다.
//  - FOR UPDATE SKIP LOCKED + lease: payment-service 가 여러 대 떠 있어도 같은 행을 두 대가 동시에 보내지 않습니다.
//  - 예약별 순서: 같은 예약에 더 앞선 미발행 이벤트가 있으면 그 이벤트는 가져가지 않습니다. 그래서 한 번에 보내는 묶음에는
//    예약마다 맨 앞 이벤트 하나만 들어가고, 앞 이벤트가 발행돼야 다음 이벤트가 나갑니다 (여러 대가 떠 있어도 순서 유지).
//  - MessageGroupId = 예약 ID: 같은 예약의 이벤트는 큐에서 순서대로 처리됩니다 (FIFO).
//  - MessageDeduplicationId = event_id: 보낸 뒤 published_at 기록 전에 죽어서 다시 보내도
//    큐가 같은 메시지로 보고 한 번만 받습니다 (SQS FIFO 중복 제거, 5분).
//  - 그래도 큐에 두 번 들어가는 경우를 대비해, 받는 쪽(booking)이 event_id UNIQUE 로 한 번만 반영합니다.
@Injectable()
export class OutboxPublisherService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly queueUrl = paymentResultQueueUrl();
  private readonly pollIntervalMs =
    Number(process.env.OUTBOX_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  onApplicationBootstrap() {
    if (!this.queueUrl) {
      this.logger.warn(
        'PAYMENT_RESULT_QUEUE_URL 이 설정되지 않아 결제 결과 이벤트를 발행하지 않습니다 (payment_outbox 에 쌓이기만 함).',
      );
      return;
    }
    this.logger.log(`결제 결과 이벤트 발행 시작: ${this.queueUrl}`);
    this.schedule(0);
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private schedule(delayMs: number) {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick() {
    try {
      const fetched = await this.publishBatch();
      // 꽉 채워 가져왔으면 더 남아 있을 수 있으니 바로 다시, 아니면 잠시 쉬었다가
      this.schedule(fetched === BATCH_SIZE ? 0 : this.pollIntervalMs);
    } catch (error: unknown) {
      this.logger.error(
        '결제 결과 이벤트 발행 중 오류 — 잠시 후 다시 시도합니다.',
        error instanceof Error ? error.stack : String(error),
      );
      this.schedule(ERROR_BACKOFF_MS);
    }
  }

  // 미발행 행을 맡아 큐로 보낸 뒤 published_at 을 기록한다. 가져온 행 수를 돌려준다.
  async publishBatch(): Promise<number> {
    const rows = await this.claim();
    if (rows.length === 0) {
      return 0;
    }

    let sentIds: string[];
    try {
      const { Successful, Failed } = await this.sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: rows.map((row) => ({
            Id: row.event_id,
            MessageBody:
              typeof row.payload === 'string'
                ? row.payload
                : JSON.stringify(row.payload),
            MessageGroupId: String(row.reservation_id),
            MessageDeduplicationId: row.event_id,
          })),
        }),
      );
      sentIds = (Successful ?? []).map((entry) => entry.Id as string);
      for (const failure of Failed ?? []) {
        this.logger.error(
          `결제 결과 이벤트 발행 실패 (event_id=${failure.Id}, code=${failure.Code}): ${failure.Message} — 잠시 후 다시 보냅니다.`,
        );
      }
    } catch (error: unknown) {
      // 요청 자체가 실패(기한 초과 포함) — 큐에 들어갔는지 모르지만, 다시 보내도 중복 제거 ID로 한 번만 받는다
      await this.release(rows.map((row) => row.event_id));
      throw error;
    }

    await this.markPublished(sentIds);
    const failedIds = rows
      .map((row) => row.event_id)
      .filter((id) => !sentIds.includes(id));
    await this.release(failedIds);
    return rows.length;
  }

  // 보낼 행을 맡는다: 아직 안 보냈고, 아무도 맡지 않았고(또는 lease가 지났고), 같은 예약에 더 앞선 미발행 이벤트가 없는 행.
  // 잠금은 이 짧은 트랜잭션 안에서만 쥐고, locked_until을 찍은 뒤 바로 커밋한다.
  private claim(): Promise<OutboxRow[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows: OutboxRow[] = await manager.query(
        `SELECT o.event_id, o.reservation_id, o.payload
           FROM payment_outbox o
          WHERE o.published_at IS NULL
            AND (o.locked_until IS NULL OR o.locked_until < NOW(6))
            AND NOT EXISTS (
              SELECT 1 FROM payment_outbox prev
               WHERE prev.reservation_id = o.reservation_id
                 AND prev.published_at IS NULL
                 AND (prev.created_at, prev.event_id) < (o.created_at, o.event_id)
            )
          ORDER BY o.created_at, o.event_id
          LIMIT ?
          FOR UPDATE SKIP LOCKED`,
        [BATCH_SIZE],
      );
      if (rows.length > 0) {
        await manager.query(
          `UPDATE payment_outbox SET locked_until = NOW(6) + INTERVAL ${LEASE_SECONDS} SECOND
            WHERE event_id IN (?)`,
          [rows.map((row) => row.event_id)],
        );
      }
      return rows;
    });
  }

  private async markPublished(eventIds: string[]) {
    if (eventIds.length === 0) {
      return;
    }
    await this.dataSource.query(
      'UPDATE payment_outbox SET published_at = NOW(6), locked_until = NULL WHERE event_id IN (?)',
      [eventIds],
    );
  }

  // 보내지 못한 행은 잠시 뒤 다시 가져갈 수 있게 lease를 짧게 줄인다
  private async release(eventIds: string[]) {
    if (eventIds.length === 0) {
      return;
    }
    await this.dataSource.query(
      `UPDATE payment_outbox SET locked_until = NOW(6) + INTERVAL ${ERROR_BACKOFF_MS / 1000} SECOND
        WHERE event_id IN (?) AND published_at IS NULL`,
      [eventIds],
    );
  }
}
