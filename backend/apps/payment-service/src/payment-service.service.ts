import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import {
  DataSource,
  EntityManager,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
} from './entities/payment.entity';
import {
  PaymentOutbox,
  PaymentOutboxEventType,
} from './entities/payment-outbox.entity';
import { PgMockClient } from './pg-mock/pg-mock.client';
import { TossPaymentsClient } from './pg/toss-payments.client';
import { PgConfirmResult } from './pg/pg-confirm-result';
import { PgCancelResult } from './pg/pg-cancel-result';

// 결제 승인 결과 (proto ApprovePaymentResponse.result, 위키 API 명세 5.9의 result와 같은 값)
export type ApproveResultType =
  'APPROVED' | 'FAILED' | 'UNKNOWN' | 'PROCESSING';

// proto의 ApprovePaymentResponse와 1:1 대응
export interface ApprovePaymentResponse {
  result: ApproveResultType;
  paymentId: number;
  retryable: boolean;
  code: string;
  message: string;
}

// MOCK 모드에서 프론트가 보내는 paymentKey가 이 접두어로 시작하면 pg-mock이 승인을 거절합니다.
// 토스 결제창 없이 "카드 거절" 화면을 확인하기 위한 개발용 장치입니다 (위키 API 명세 5.9).
const MOCK_FAIL_PAYMENT_KEY_PREFIX = 'mock_fail_';

// 어느 PG로 승인할지 — 환경변수 PAYMENT_PROVIDER (기본 MOCK). 성능 테스트·로컬은 MOCK, 실제 토스 연동은 TOSS
function currentProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === 'TOSS'
    ? PaymentProvider.TOSS
    : PaymentProvider.MOCK;
}

// TypeORM update()의 타입 추론이 json 컬럼(Record<string, unknown>)을 받아들이지 못해서 맞춰 주는 변환
function toJsonColumn(
  value: Record<string, unknown>,
): QueryDeepPartialEntity<Payment>['rawResponse'] {
  return value as QueryDeepPartialEntity<Payment>['rawResponse'];
}

// MariaDB UNIQUE 위반(ER_DUP_ENTRY)인지. constraint를 주면 그 제약 이름이 들어간 경우만 true
function isDuplicateKeyError(error: unknown, constraint?: string): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: string; message?: string };
  if (driverError?.code !== 'ER_DUP_ENTRY') {
    return false;
  }
  return constraint ? (driverError.message ?? '').includes(constraint) : true;
}

// proto의 Payment 메시지와 1:1 대응되는 응답 형태
export interface PaymentGrpcResponse {
  paymentId: number;
  reservationId: number;
  approvalNumber: string;
  amount: number;
  paymentMethod: string;
  status: string;
  paidAt: string;
  userId: number;
  receiptUrl: string; // PG 영수증 주소 (없으면 빈 문자열)
}

// 저장된 PG 응답(raw_response)에서 영수증 주소를 꺼낸다 — 토스 승인 응답의 receipt.url (LDP-124).
// 환불 뒤에도 승인 응답 원본은 그대로 두고 cancel 아래에 덧붙이므로 같은 주소가 남는다. pg-mock은 영수증이 없다.
function receiptUrlOf(rawResponse: Record<string, unknown> | null): string {
  const receipt = rawResponse?.receipt as { url?: unknown } | null | undefined;
  return typeof receipt?.url === 'string' ? receipt.url : '';
}

@Injectable()
export class PaymentServiceService {
  private readonly logger = new Logger(PaymentServiceService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly pgMockClient: PgMockClient,
    private readonly tossPaymentsClient: TossPaymentsClient,
    private readonly dataSource: DataSource,
  ) {}

  getHello(): string {
    return 'Payment Hello World!';
  }

  // PG 웹훅 수신 (api-gateway가 pg-mock 서명을 검증한 뒤 호출). 지금은 기록(로그)만 한다 — LDP-102.
  //
  // 예전에는 옛 결제 방식(POST /api/payments, 주문번호 = 예약 ID)의 "승인됐는데 기록 없음"을 웹훅으로 구제하면서
  // booking-service를 gRPC로 직접 불렀다(예약 소유자 조회·예약 확정). 결제 → 메인 직접 호출은 운영 구조
  // (메인 → 결제만 PrivateLink, 결제 → 메인은 SQS)에 맞지 않아 옛 결제 방식과 함께 제거했다.
  //  - 새 결제 흐름(결제 준비 → 승인)은 PG 승인 전에 결제 기록(PROCESSING)을 먼저 남겨서 "기록 없음"이 생기지 않는다.
  //  - 결과를 모르는 결제(UNKNOWN)는 대사 배치(LDP-97)가 PG 조회로 확정하고 Outbox → SQS로 예약에 알린다.
  //  - 토스 웹훅을 받게 되면 결제 VPC 경로(API Gateway → Lambda → SQS)로 받아 pg_webhook_inbox 기록 + PG 조회로
  //    재확인한 뒤 같은 Outbox 경로를 쓴다 (ERD 위키 "결제 흐름과 테이블").
  handlePaymentWebhook(data: {
    eventType: string;
    orderId: string;
    amount: number;
    paymentMethod: string;
    approvalNumber: string;
    paymentKey: string;
  }): void {
    this.logger.log(
      `PG 웹훅 수신 — 기록만 함 (eventType=${data.eventType}, orderId=${data.orderId}, amount=${data.amount})`,
    );
  }

  // 결제 승인 (booking-service의 ConfirmPayment가 호출, 위키 API 명세 5.9 / ERD "정상 승인" 흐름).
  //   1) 멱등 키로 payments에 PROCESSING을 먼저 기록한다. idempotency_key가 UNIQUE라서 같은 요청이
  //      재시도로 두 번 와도 두 번째 INSERT는 DB가 막고, 이미 기록된 결과를 그대로 돌려준다 (중복 결제 방지).
  //   2) PG(MOCK: pg-mock / TOSS: 토스 승인 API)에 승인을 요청한다.
  //   3) 결과를 반영한다 — 승인이면 한 트랜잭션에서 APPROVED 전환 + payment_outbox 기록,
  //      거절이면 FAILED + outbox, 타임아웃 등으로 알 수 없으면 UNKNOWN (대사 배치가 PG 조회로 확정).
  // 상태 변경은 모두 "WHERE status = PROCESSING" 조건부 UPDATE라서, 같은 결제를 다른 경로(웹훅·대사 배치)가
  // 동시에 처리해도 한 번만 반영된다 (ERD 설계 원칙 4).
  // 결제 결과(거절·타임아웃 포함)는 에러로 던지지 않고 result로 돌려준다 — booking-service가 그대로 화면에 전달.
  async approvePayment(data: {
    idempotencyKey: string;
    reservationId: number;
    userId: number;
    orderId: string;
    paymentKey: string;
    amount: number;
    orderName: string;
  }): Promise<ApprovePaymentResponse> {
    const provider = currentProvider();

    // 1) PROCESSING 선기록 (멱등)
    let payment: Payment;
    try {
      payment = await this.paymentRepository.save(
        this.paymentRepository.create({
          reservationId: data.reservationId,
          userId: data.userId,
          idempotencyKey: data.idempotencyKey,
          pgOrderId: data.orderId,
          provider,
          amount: data.amount,
          paymentMethod: '', // PG 승인 응답의 결제수단으로 채움
          status: PaymentStatus.PROCESSING,
        }),
      );
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      // 같은 멱등 키로 이미 기록된 결제 → 다시 승인하지 않고 그 결과를 돌려준다
      const existing = await this.paymentRepository.findOne({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (!existing) {
        throw error;
      }
      this.logger.log(
        `같은 멱등 키의 결제가 이미 있어 기존 결과를 돌려줍니다 (paymentId=${existing.paymentId}, status=${existing.status})`,
      );
      return this.toApproveResponse(existing);
    }

    // 2) PG 승인 요청
    const pgResult: PgConfirmResult =
      provider === PaymentProvider.TOSS
        ? await this.tossPaymentsClient.confirm({
            paymentKey: data.paymentKey,
            orderId: data.orderId,
            amount: data.amount,
            idempotencyKey: data.idempotencyKey,
          })
        : await this.pgMockClient.confirm({
            orderId: data.orderId,
            amount: data.amount,
            orderName: data.orderName,
            forceFail: data.paymentKey.startsWith(MOCK_FAIL_PAYMENT_KEY_PREFIX),
          });

    // 3) 결과 반영
    if (pgResult.outcome === 'APPROVED') {
      return this.markApproved(payment, pgResult);
    }
    if (pgResult.outcome === 'DECLINED') {
      await this.markFailed(payment, pgResult);
      return {
        result: 'FAILED',
        paymentId: payment.paymentId,
        retryable: true,
        code: 'PAYMENT_DECLINED',
        message:
          pgResult.pgMessage ??
          '카드 승인이 거절되었습니다. 다른 결제수단으로 다시 시도해 주세요.',
      };
    }
    await this.markUnknown(payment, pgResult);
    return {
      result: 'UNKNOWN',
      paymentId: payment.paymentId,
      retryable: false,
      code: '',
      message:
        '결제 결과를 확인하고 있습니다. 잠시 후 예약 내역에서 확인해 주세요.',
    };
  }

  // 결과 불명 반영: UNKNOWN + PG 결제 번호. 대사 배치(LDP-97)가 이 번호로 PG에 조회해 승인·실패를 확정한다 (LDP-91).
  // 결제 번호는 UNIQUE라, 혹시 다른 결제가 이미 같은 번호를 갖고 있으면 번호 없이라도 UNKNOWN은 남긴다.
  private async markUnknown(
    payment: Payment,
    pgResult: PgConfirmResult,
  ): Promise<void> {
    const update = (paymentKey: string | null) =>
      this.dataSource.manager.update(
        Payment,
        { paymentId: payment.paymentId, status: PaymentStatus.PROCESSING },
        {
          status: PaymentStatus.UNKNOWN,
          paymentKey,
          rawResponse: toJsonColumn({
            ...(pgResult.raw ?? {}),
            pgMessage: pgResult.pgMessage,
          }),
        },
      );
    try {
      await update(pgResult.paymentKey ?? null);
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error) || !pgResult.paymentKey) {
        throw error;
      }
      this.logger.error(
        `[알람] 결과 불명 결제의 PG 결제 번호가 다른 결제와 겹칩니다 — 번호 없이 UNKNOWN으로 남김 (paymentId=${payment.paymentId}, paymentKey=${pgResult.paymentKey})`,
      );
      await update(null);
    }
  }

  // 승인 반영: APPROVED 전환과 payment_outbox 기록을 한 트랜잭션으로 — 상태는 바뀌었는데 예약 쪽에
  // 알릴 이벤트가 유실되는 일을 막는다 (Transactional Outbox). 발행(SQS)은 LDP-26의 발행기가 맡는다.
  private async markApproved(
    payment: Payment,
    pgResult: PgConfirmResult,
  ): Promise<ApprovePaymentResponse> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const { affected } = await manager.update(
          Payment,
          { paymentId: payment.paymentId, status: PaymentStatus.PROCESSING },
          {
            status: PaymentStatus.APPROVED,
            paymentKey: pgResult.paymentKey ?? null,
            approvalNumber: pgResult.approvalNumber ?? null,
            paymentMethod: pgResult.method ?? '',
            paidAt: pgResult.approvedAt ?? new Date(),
            rawResponse: toJsonColumn({ ...(pgResult.raw ?? {}) }),
          },
        );
        if (!affected) {
          // 이미 다른 경로가 상태를 바꿈 — 이벤트를 중복으로 쌓지 않는다
          return;
        }
        await this.insertOutbox(
          manager,
          payment,
          PaymentOutboxEventType.PAYMENT_APPROVED,
          {
            retryable: false,
          },
        );
      });
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error, 'uk_approved_reservation')) {
        throw error;
      }
      // 같은 예약에 이미 승인된 결제가 있음 → 이 건은 실패 처리하고 PG 승인을 되돌려야 한다
      // (ERD "테이블이 쓰이는 곳": 두 번째 건은 실패 → 즉시 취소, 알람)
      await this.handleDuplicateApproval(payment, pgResult);
      return {
        result: 'FAILED',
        paymentId: payment.paymentId,
        retryable: false,
        code: 'ALREADY_PAID',
        message: '이미 결제가 완료된 예약입니다.',
      };
    }

    return {
      result: 'APPROVED',
      paymentId: payment.paymentId,
      retryable: false,
      code: '',
      message: '결제가 승인되었습니다.',
    };
  }

  // 거절 반영: FAILED 전환 + payment_outbox(PAYMENT_FAILED)를 한 트랜잭션으로
  private async markFailed(
    payment: Payment,
    pgResult: PgConfirmResult,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager.update(
        Payment,
        { paymentId: payment.paymentId, status: PaymentStatus.PROCESSING },
        {
          status: PaymentStatus.FAILED,
          rawResponse: toJsonColumn({
            ...(pgResult.raw ?? {}),
            pgCode: pgResult.pgCode,
            pgMessage: pgResult.pgMessage,
          }),
        },
      );
      if (!affected) {
        return;
      }
      await this.insertOutbox(
        manager,
        payment,
        PaymentOutboxEventType.PAYMENT_FAILED,
        {
          retryable: true,
        },
      );
    });
  }

  // 같은 예약에 승인된 결제가 이미 있는데 PG가 또 승인한 경우: 이 건을 FAILED로 두고 PG 승인을 취소한다.
  private async handleDuplicateApproval(
    payment: Payment,
    pgResult: PgConfirmResult,
  ): Promise<void> {
    this.logger.error(
      `[알람] 예약(#${payment.reservationId})에 이미 승인된 결제가 있는데 중복 승인됨 (paymentId=${payment.paymentId}, paymentKey=${pgResult.paymentKey})`,
    );
    await this.dataSource.manager.update(
      Payment,
      { paymentId: payment.paymentId, status: PaymentStatus.PROCESSING },
      {
        status: PaymentStatus.FAILED,
        paymentKey: pgResult.paymentKey ?? null,
        rawResponse: toJsonColumn({
          ...(pgResult.raw ?? {}),
          duplicateApproval: true,
        }),
      },
    );
    if (!pgResult.paymentKey) {
      return;
    }
    if (payment.provider === PaymentProvider.TOSS) {
      const cancel = await this.tossPaymentsClient.cancel({
        paymentKey: pgResult.paymentKey,
        cancelReason: '중복 승인 자동 취소',
        idempotencyKey: randomUUID(),
      });
      if (cancel.outcome !== 'CANCELED') {
        this.logger.error(
          `[알람] 토스 중복 승인 자동 취소 실패 — 수동 취소 필요 (paymentKey=${pgResult.paymentKey})`,
        );
      }
      return;
    }
    await this.pgMockClient
      .cancel(pgResult.paymentKey, { cancelReason: '중복 승인 자동 취소' })
      .catch((error: unknown) => {
        this.logger.error(
          `[알람] pg-mock 중복 승인 취소 실패 (paymentKey=${pgResult.paymentKey})`,
          error instanceof Error ? error.stack : String(error),
        );
      });
  }

  // payment_outbox 기록. 페이로드 형식은 위키 API 명세 6.6 (#39 LDP-26에서 발행·수신 구현 시 확정)
  private async insertOutbox(
    manager: EntityManager,
    payment: Payment,
    eventType: PaymentOutboxEventType,
    extra: { retryable: boolean },
  ): Promise<void> {
    const eventId = randomUUID();
    await manager.insert(PaymentOutbox, {
      eventId,
      eventType,
      reservationId: payment.reservationId,
      paymentId: payment.paymentId,
      payload: {
        eventId,
        eventType,
        reservationId: payment.reservationId,
        paymentId: payment.paymentId,
        orderId: payment.pgOrderId,
        amount: payment.amount,
        retryable: extra.retryable,
        occurredAt: new Date().toISOString(),
      },
    });
  }

  // 이미 기록된 결제(멱등 재요청)를 승인 응답 형태로 바꾼다.
  private toApproveResponse(payment: Payment): ApprovePaymentResponse {
    const base = { paymentId: payment.paymentId, code: '', retryable: false };
    switch (payment.status) {
      case PaymentStatus.APPROVED:
      case PaymentStatus.REFUND_REQUESTED:
      case PaymentStatus.REFUND_FAILED:
      case PaymentStatus.REFUNDED:
        return {
          ...base,
          result: 'APPROVED',
          message: '결제가 승인되었습니다.',
        };
      case PaymentStatus.FAILED:
        return {
          ...base,
          result: 'FAILED',
          retryable: true,
          code: 'PAYMENT_DECLINED',
          message:
            '카드 승인이 거절되었습니다. 다른 결제수단으로 다시 시도해 주세요.',
        };
      case PaymentStatus.UNKNOWN:
        return {
          ...base,
          result: 'UNKNOWN',
          message:
            '결제 결과를 확인하고 있습니다. 잠시 후 예약 내역에서 확인해 주세요.',
        };
      default:
        return {
          ...base,
          result: 'PROCESSING',
          message:
            '결제를 처리하고 있습니다. 잠시 후 예약 내역에서 확인해 주세요.',
        };
    }
  }

  // 단건 결제 상세 조회 (관리자 전용, 권한 검증은 api-gateway에서 수행)
  async getPaymentById(paymentId: number): Promise<PaymentGrpcResponse> {
    const payment = await this.paymentRepository.findOne({
      where: { paymentId },
    });
    if (!payment) {
      throw new RpcException('존재하지 않는 결제내역입니다.');
    }
    return this.toGrpcResponse(payment);
  }

  // 특정 유저의 결제 목록 조회. /me(본인 조회)와 /{userId}(관리자 조회) 양쪽에서 재사용된다.
  async getPaymentsByUserId(userId: number): Promise<PaymentGrpcResponse[]> {
    const payments = await this.paymentRepository.find({
      where: { userId },
      order: { paidAt: 'DESC' },
    });
    return payments.map((payment) => this.toGrpcResponse(payment));
  }

  // 환불 (LDP-28, ERD "환불: 요청은 PrivateLink, 결과는 SQS"). 예약 취소 시 booking-service가 항상 호출한다.
  //   1) 이 예약의 승인된 결제(approved_reservation_id = 예약 ID)를 찾는다. 없으면 NO_PAYMENT(결제 전 취소 등).
  //   2) APPROVED(또는 이전에 실패한 REFUND_FAILED) -> REFUND_REQUESTED 조건부 UPDATE + 환불 멱등 키 기록.
  //      조건부라서 같은 환불이 동시에 두 번 와도 한쪽만 PG 취소로 넘어간다.
  //   3) PG(MOCK: pg-mock / TOSS: 토스 취소 API)에 같은 멱등 키로 취소를 요청한다.
  //   4) 한 트랜잭션에서 REFUNDED(또는 REFUND_FAILED) 전환 + payment_outbox(PAYMENT_REFUNDED / PAYMENT_REFUND_FAILED).
  //      결과는 큐를 통해 booking-service의 payment_result_inbox에 기록된다 (LDP-26 경로).
  // PG 취소에 실패해도 에러를 던지지 않고 REFUND_FAILED로 남긴다 — 같은 키로 다시 시도하면 되고(대사 배치·재요청),
  // 실제로 환불되지 않은 결제를 환불된 것처럼 기록하지 않는다.
  async refundPayment(data: {
    reservationId: number;
    refundIdempotencyKey?: string;
  }): Promise<{ refunded: boolean; status: string }> {
    const payment = await this.paymentRepository.findOne({
      where: { approvedReservationId: data.reservationId },
    });
    if (!payment) {
      return { refunded: false, status: 'NO_PAYMENT' };
    }
    if (payment.status === PaymentStatus.REFUNDED) {
      // 이미 환불 완료 — 같은 취소의 재시도
      return { refunded: true, status: PaymentStatus.REFUNDED };
    }
    if (payment.status === PaymentStatus.REFUND_REQUESTED) {
      // 다른 요청이 지금 PG 취소 중 — 결과는 그쪽이 기록하고 이벤트로 알린다
      return { refunded: false, status: PaymentStatus.REFUND_REQUESTED };
    }

    // 한 번 정한 환불 멱등 키는 바꾸지 않는다 (REFUND_FAILED 재시도도 같은 키 → PG가 한 번만 취소)
    const refundKey =
      payment.refundIdempotencyKey || data.refundIdempotencyKey || randomUUID();
    const { affected } = await this.paymentRepository.update(
      {
        paymentId: payment.paymentId,
        status: In([PaymentStatus.APPROVED, PaymentStatus.REFUND_FAILED]),
      },
      {
        status: PaymentStatus.REFUND_REQUESTED,
        refundIdempotencyKey: refundKey,
      },
    );
    if (!affected) {
      // 그 사이 다른 요청이 상태를 바꿈 → 지금 상태를 그대로 알려준다
      const current = await this.paymentRepository.findOne({
        where: { paymentId: payment.paymentId },
      });
      return {
        refunded: current?.status === PaymentStatus.REFUNDED,
        status: current?.status ?? 'UNKNOWN',
      };
    }

    const cancelResult: PgCancelResult = !payment.paymentKey
      ? {
          outcome: 'FAILED',
          pgCode: 'PAYMENT_KEY_MISSING',
          pgMessage: `환불할 결제(#${payment.paymentId})에 PG 결제 키가 없습니다.`,
        }
      : payment.provider === PaymentProvider.TOSS
        ? await this.tossPaymentsClient.cancel({
            paymentKey: payment.paymentKey,
            cancelReason: '예약 취소',
            idempotencyKey: refundKey,
          })
        : await this.pgMockClient.refund(payment.paymentKey, '예약 취소');

    const refunded = cancelResult.outcome === 'CANCELED';
    await this.dataSource.transaction(async (manager) => {
      const { affected: done } = await manager.update(
        Payment,
        {
          paymentId: payment.paymentId,
          status: PaymentStatus.REFUND_REQUESTED,
        },
        {
          status: refunded
            ? PaymentStatus.REFUNDED
            : PaymentStatus.REFUND_FAILED,
          refundedAt: refunded ? (cancelResult.canceledAt ?? new Date()) : null,
          // 승인 응답 원본은 그대로 두고 취소 응답을 cancel 아래에 덧붙인다
          rawResponse: toJsonColumn({
            ...(payment.rawResponse ?? {}),
            cancel: {
              ...(cancelResult.raw ?? {}),
              pgCode: cancelResult.pgCode,
              pgMessage: cancelResult.pgMessage,
            },
          }),
        },
      );
      if (!done) {
        return;
      }
      await this.insertOutbox(
        manager,
        payment,
        refunded
          ? PaymentOutboxEventType.PAYMENT_REFUNDED
          : PaymentOutboxEventType.PAYMENT_REFUND_FAILED,
        { retryable: false },
      );
    });

    if (!refunded) {
      this.logger.error(
        `[알람] 환불 실패 — REFUND_FAILED로 두고 재시도 대상 (paymentId=${payment.paymentId}, reservationId=${data.reservationId}, code=${cancelResult.pgCode}): ${cancelResult.pgMessage}`,
      );
    }
    return {
      refunded,
      status: refunded ? PaymentStatus.REFUNDED : PaymentStatus.REFUND_FAILED,
    };
  }

  private toGrpcResponse(payment: Payment): PaymentGrpcResponse {
    return {
      paymentId: payment.paymentId,
      reservationId: payment.reservationId,
      // 승인 전(PROCESSING 등) 결제는 승인번호/승인 시각이 아직 없어서 빈 문자열로 내려줍니다
      // (proto3 string 필드는 null을 담을 수 없음).
      approvalNumber: payment.approvalNumber ?? '',
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      status: payment.status,
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : '',
      userId: payment.userId,
      receiptUrl: receiptUrlOf(payment.rawResponse),
    };
  }
}
