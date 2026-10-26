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
import {
  PaymentResultEvent,
  SQS_CLIENT,
  paymentResultQueueUrl,
  errorTrace,
} from '@app/common';
import { BookingServiceService } from '../booking-service.service';

// 롱 폴링: 메시지가 없으면 최대 이 시간(초)까지 기다렸다가 빈 응답을 받는다. 메시지가 오면 바로 돌아오므로
// 결제 후 예약 확정이 늦어지지 않는다 (SQS·ElasticMQ 최대 20초).
const WAIT_TIME_SECONDS = 10;
// 롱 폴링 호출 기한 — 대기 시간 + 여유. SQS 클라이언트 기본 기한(5초, libs/common sqs.ts)은 롱 폴링보다 짧아서 따로 준다
const RECEIVE_REQUEST_TIMEOUT_MS = (WAIT_TIME_SECONDS + 5) * 1000;
const MAX_MESSAGES = 10;
// 큐 연결 오류 시 다시 시도하기 전 기다리는 시간
const ERROR_BACKOFF_MS = 3000;

// 결제 결과 이벤트 수신기 (Transactional Outbox / Inbox 패턴의 "받는 쪽").
// 결제 결과 큐(SQS FIFO / ElasticMQ)에서 메시지를 받아 BookingServiceService.applyPaymentResult 로 반영하고,
// 반영에 성공한 메시지만 큐에서 지운다.
//  - 반영 중 오류가 나면 지우지 않는다 → visibility timeout(30초) 뒤 큐가 다시 보내고,
//    5번 받아도 처리 못 하면 DLQ(payment-result-dlq.fifo)로 옮겨진다 (infra/ansible/README.md 14-6).
//  - 같은 메시지가 두 번 와도 applyPaymentResult 가 event_id UNIQUE 로 한 번만 반영한다.
@Injectable()
export class PaymentResultConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PaymentResultConsumer.name);
  private readonly queueUrl = paymentResultQueueUrl();
  private stopped = false;
  // 종료할 때 기다리던 롱 폴링 요청을 바로 끊기 위한 장치
  private readonly abortController = new AbortController();

  constructor(
    private readonly bookingService: BookingServiceService,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  onApplicationBootstrap() {
    if (!this.queueUrl) {
      this.logger.warn(
        'PAYMENT_RESULT_QUEUE_URL 이 설정되지 않아 결제 결과 이벤트를 받지 않습니다 (예약 확정이 반영되지 않음).',
      );
      return;
    }
    this.logger.log(`결제 결과 이벤트 수신 시작: ${this.queueUrl}`);
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
          '결제 결과 큐 수신 오류 — 잠시 후 다시 시도합니다.',
          errorTrace(error),
        );
        await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
      }
    }
  }

  // 메시지 하나를 반영하고 성공하면 지운다. 실패하면 로그만 남기고 지우지 않는다(큐가 다시 보냄).
  async handle(message: Message): Promise<void> {
    let event: PaymentResultEvent;
    try {
      event = JSON.parse(message.Body ?? '') as PaymentResultEvent;
    } catch {
      // 형식이 깨진 메시지는 몇 번을 다시 받아도 처리할 수 없다 → 지우지 않고 두어 DLQ로 가게 한다
      this.logger.error(
        `결제 결과 메시지 형식 오류 (MessageId=${message.MessageId}) — DLQ로 이동될 때까지 남겨둡니다.`,
      );
      return;
    }

    try {
      await this.bookingService.applyPaymentResult(event);
    } catch (error: unknown) {
      this.logger.error(
        `결제 결과 이벤트 반영 실패 (event_id=${event.eventId}, type=${event.eventType}) — 큐가 다시 보냅니다.`,
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
