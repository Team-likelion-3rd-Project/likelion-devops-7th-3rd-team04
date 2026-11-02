import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SQS_CLIENT, errorTrace, paymentWebhookQueueUrl } from '@app/common';
import {
  TossWebhookInboxService,
  TossWebhookMessage,
} from './toss-webhook-inbox.service';

// 값의 의미는 booking-service payment-result.consumer.ts와 같다
const WAIT_TIME_SECONDS = 10;
const RECEIVE_REQUEST_TIMEOUT_MS = (WAIT_TIME_SECONDS + 5) * 1000;
const MAX_MESSAGES = 10;
const ERROR_BACKOFF_MS = 3000;

// body가 문자열이거나 없으면 eventType을 읽지 못해 "처리 대상 아님"으로 지워지므로 형식 오류로 본다
function parseMessage(raw: string | undefined): TossWebhookMessage | null {
  try {
    const parsed = JSON.parse(raw ?? '') as Partial<TossWebhookMessage> | null;
    return typeof parsed?.body === 'object' && parsed.body !== null
      ? (parsed as TossWebhookMessage)
      : null;
  } catch {
    return null;
  }
}

// 토스 웹훅 수신기. 큐(SQS / ElasticMQ)에서 메시지를 받아 pg_webhook_inbox에 저장하고, 저장에 성공한 메시지만 지운다.
//  - 저장에 실패하거나 형식이 깨진 메시지는 지우지 않는다 → visibility timeout(30초) 뒤 큐가 다시 보내고,
//    5번 받아도 처리 못 하면 DLQ(payment-webhook-dlq)로 옮겨진다.
//  - 같은 웹훅이 두 번 와도 pg_event_key UNIQUE로 한 건만 저장된다.
@Injectable()
export class TossWebhookConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TossWebhookConsumer.name);
  private readonly queueUrl = paymentWebhookQueueUrl();
  private stopped = false;
  // 종료할 때 기다리던 롱 폴링 요청을 바로 끊기 위한 장치
  private readonly abortController = new AbortController();

  constructor(
    private readonly inbox: TossWebhookInboxService,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  onApplicationBootstrap() {
    if (!this.queueUrl) {
      this.logger.warn(
        'PAYMENT_WEBHOOK_QUEUE_URL 이 설정되지 않아 토스 웹훅을 받지 않습니다.',
      );
      return;
    }
    this.logger.log(`토스 웹훅 수신 시작: ${this.queueUrl}`);
    void this.loop();
  }

  onApplicationShutdown() {
    this.stopped = true;
    this.abortController.abort();
  }

  private async loop() {
    while (!this.stopped) {
      try {
        const { Messages } = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: MAX_MESSAGES,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
          }),
          {
            abortSignal: this.abortController.signal,
            requestTimeout: RECEIVE_REQUEST_TIMEOUT_MS,
          },
        );
        for (const message of Messages ?? []) {
          await this.handle(message);
        }
      } catch (error: unknown) {
        if (this.stopped) {
          return;
        }
        this.logger.error(
          '토스 웹훅 큐 수신 오류 — 잠시 후 다시 시도합니다.',
          errorTrace(error),
        );
        await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
      }
    }
  }

  // 메시지 하나를 저장하고 성공하면 지운다. 실패하면 로그만 남기고 지우지 않는다(큐가 다시 보냄).
  async handle(message: Message): Promise<void> {
    const parsed = parseMessage(message.Body);
    if (!parsed) {
      this.logger.error(
        `토스 웹훅 메시지 형식 오류 (MessageId=${message.MessageId}) — DLQ로 이동될 때까지 남겨둡니다.`,
      );
      return;
    }

    try {
      await this.inbox.record(parsed);
    } catch (error: unknown) {
      this.logger.error(
        `토스 웹훅 저장 실패 (MessageId=${message.MessageId}) — 큐가 다시 보냅니다.`,
        errorTrace(error),
      );
      return;
    }

    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }
}
