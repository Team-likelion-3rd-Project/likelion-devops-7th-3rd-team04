import { createHmac, randomInt, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CancelPaymentDto } from './dto/cancel-payment.dto';
import { PaymentRecord } from './payment-record.interface';

type WebhookEventType = 'PAYMENT.APPROVED' | 'PAYMENT.CANCELED';

const DEFAULT_MOCK_SECRET = 'mock-pg-secret';
const WEBHOOK_TIMEOUT_MS = 5000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  // DB 없이 인메모리 Map으로만 상태를 관리합니다. (payment-record.interface.ts 주석 참고)
  private readonly payments = new Map<string, PaymentRecord>();

  constructor(private readonly httpService: HttpService) {}

  create(dto: CreatePaymentDto): PaymentRecord {
    const paymentKey = `pgmock_${randomUUID()}`;
    const record: PaymentRecord = {
      paymentKey,
      orderId: dto.orderId,
      amount: dto.amount,
      orderName: dto.orderName,
      paymentMethod: dto.paymentMethod,
      status: 'READY',
      createdAt: new Date().toISOString(),
    };
    this.payments.set(paymentKey, record);
    return record;
  }

  findOne(paymentKey: string): PaymentRecord {
    const record = this.payments.get(paymentKey);
    if (!record) {
      throw new NotFoundException(
        `결제 요청을 찾을 수 없습니다: ${paymentKey}`,
      );
    }
    return record;
  }

  approve(paymentKey: string, mockResult?: string): PaymentRecord {
    const record = this.findOne(paymentKey);

    if (record.status !== 'READY') {
      throw new ConflictException(
        `이미 처리된 결제입니다 (현재 상태: ${record.status})`,
      );
    }

    // X-Mock-Result: fail 헤더로 승인 실패 상황(한도 초과 등)을 의도적으로 재현할 수 있습니다.
    // 실패 시 상태는 바꾸지 않아 READY 상태 그대로 재시도할 수 있게 둡니다.
    if (mockResult === 'fail') {
      throw new BadRequestException(
        '결제 승인에 실패했습니다. (mock 강제 실패)',
      );
    }

    record.status = 'DONE';
    record.approvedAt = new Date().toISOString();
    // 실제 카드사 승인번호를 흉내낸 8자리 숫자. paymentKey와 달리 승인 시점에만 생성됩니다.
    record.approvalNumber = randomInt(10_000_000, 99_999_999).toString();

    this.sendWebhook('PAYMENT.APPROVED', record);
    return record;
  }

  cancel(paymentKey: string, dto: CancelPaymentDto): PaymentRecord {
    const record = this.findOne(paymentKey);

    if (record.status !== 'DONE') {
      throw new ConflictException(
        `승인된 결제만 취소할 수 있습니다 (현재 상태: ${record.status})`,
      );
    }

    record.status = 'CANCELED';
    record.canceledAt = new Date().toISOString();
    record.cancelReason = dto.cancelReason;

    this.sendWebhook('PAYMENT.CANCELED', record);
    return record;
  }

  // 실제 PG사가 승인/취소 결과를 가맹점 서버에 비동기로 통보하는 것을 흉내냅니다.
  // 수신 측(payment-service) 웹훅 엔드포인트는 별도 이슈에서 구현되므로, 이 시점에는
  // 존재하지 않을 수 있습니다. 그래서 (1) 응답을 기다리지 않고(fire-and-forget),
  // (2) URL 미설정/발송 실패 모두 approve/cancel API 자체의 실패로 이어지지 않게 합니다.
  private sendWebhook(eventType: WebhookEventType, record: PaymentRecord) {
    const webhookUrl = process.env.PAYMENT_SERVICE_WEBHOOK_URL;
    if (!webhookUrl) {
      this.logger.warn(
        `PAYMENT_SERVICE_WEBHOOK_URL이 설정되지 않아 웹훅을 보내지 않습니다. (event=${eventType}, paymentKey=${record.paymentKey})`,
      );
      return;
    }

    const payload = {
      eventType,
      paymentKey: record.paymentKey,
      orderId: record.orderId,
      amount: record.amount,
      paymentMethod: record.paymentMethod,
      approvalNumber: record.approvalNumber,
      status: record.status,
      occurredAt: new Date().toISOString(),
    };
    // 실제 PG의 위변조 방지 서명을 흉내낸 HMAC 서명입니다. 수신 측(api-gateway의
    // POST /api/payments/webhook)이 동일한 알고리즘(HMAC-SHA256, 같은 payload 키 순서)으로
    // 재계산해 검증합니다 — 이 함수의 payload 필드 구성을 바꾸면 수신 측도 같이 바꿔야 합니다.
    const signature = createHmac(
      'sha256',
      process.env.MOCK_PG_SECRET || DEFAULT_MOCK_SECRET,
    )
      .update(JSON.stringify(payload))
      .digest('hex');

    firstValueFrom(
      this.httpService.post(
        webhookUrl,
        { ...payload, signature },
        { timeout: WEBHOOK_TIMEOUT_MS },
      ),
    ).catch((error: Error) => {
      this.logger.error(
        `웹훅 발송 실패 (event=${eventType}, paymentKey=${record.paymentKey}): ${error.message}`,
      );
    });
  }
}
