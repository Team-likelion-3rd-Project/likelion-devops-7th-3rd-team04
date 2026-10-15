import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { SQS_CLIENT, paymentResultQueueUrl } from '@app/common';

// 한 번에 가져와 보낼 최대 행 수
const BATCH_SIZE = 10;
// 보낼 게 없을 때 다음 확인까지 기다리는 시간. 결제 후 1초 안에 예약이 확정되도록(이슈 #39 완료 조건) 짧게 둡니다.
const DEFAULT_POLL_INTERVAL_MS = 500;
// DB·큐 오류가 났을 때 다시 시도하기 전 기다리는 시간
const ERROR_BACKOFF_MS = 3000;

interface OutboxRow {
  event_id: string;
  reservation_id: number;
  payload: string | Record<string, unknown>;
}

// Outbox 발행기 (Transactional Outbox 패턴의 "보내는 쪽").
// payment_outbox 에서 아직 안 보낸 행(published_at IS NULL)을 꺼내 결제 결과 큐(SQS FIFO / ElasticMQ)로
// 보내고, 성공한 행에 published_at 을 기록합니다.
//
//  - FOR UPDATE SKIP LOCKED: payment-service 가 여러 대 떠 있어도 같은 행을 두 대가 동시에 보내지 않게,
//    다른 쪽이 잡고 있는 행은 기다리지 않고 건너뜁니다.
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

  // 미발행 행을 잠그고 가져와 큐로 보낸 뒤 published_at 을 기록한다. 가져온 행 수를 돌려준다.
  async publishBatch(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows: OutboxRow[] = await manager.query(
        `SELECT event_id, reservation_id, payload
           FROM payment_outbox
          WHERE published_at IS NULL
          ORDER BY created_at, event_id
          LIMIT ?
          FOR UPDATE SKIP LOCKED`,
        [BATCH_SIZE],
      );

      for (const row of rows) {
        try {
          await this.sqs.send(
            new SendMessageCommand({
              QueueUrl: this.queueUrl,
              MessageBody:
                typeof row.payload === 'string'
                  ? row.payload
                  : JSON.stringify(row.payload),
              MessageGroupId: String(row.reservation_id),
              MessageDeduplicationId: row.event_id,
            }),
          );
        } catch (error: unknown) {
          // 같은 예약의 다음 이벤트가 앞질러 나가지 않도록, 실패하면 이번 묶음은 여기서 멈추고 다음에 다시 보낸다
          this.logger.error(
            `결제 결과 이벤트 발행 실패 (event_id=${row.event_id}) — 다음 주기에 다시 보냅니다.`,
            error instanceof Error ? error.stack : String(error),
          );
          break;
        }
        await manager.query(
          'UPDATE payment_outbox SET published_at = NOW(6) WHERE event_id = ?',
          [row.event_id],
        );
      }
      return rows.length;
    });
  }
}
