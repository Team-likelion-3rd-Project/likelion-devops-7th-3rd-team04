import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentServiceService } from './payment-service.service';
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
} from './entities/payment.entity';
import { PgMockClient } from './pg-mock/pg-mock.client';
import { TossPaymentsClient } from './pg/toss-payments.client';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  PaymentOutbox,
  PaymentOutboxEventType,
} from './entities/payment-outbox.entity';

describe('PaymentServiceService', () => {
  let service: PaymentServiceService;

  const cancelMock = jest.fn();
  const findOneMock = jest.fn();
  const createMock = jest.fn();
  const saveMock = jest.fn();
  const pgMockConfirmMock = jest.fn();
  const tossConfirmMock = jest.fn();
  const repoUpdateMock = jest.fn();
  const pgMockRefundMock = jest.fn();
  const tossCancelMock = jest.fn();
  // 트랜잭션 안에서 쓰는 EntityManager 대역 — update/insert 호출을 확인한다
  const managerUpdateMock = jest.fn();
  const managerInsertMock = jest.fn();
  const manager = { update: managerUpdateMock, insert: managerInsertMock };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentServiceService,
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            findOne: findOneMock,
            create: createMock,
            save: saveMock,
            update: repoUpdateMock,
          },
        },
        {
          provide: PgMockClient,
          useValue: {
            cancel: cancelMock,
            confirm: pgMockConfirmMock,
            refund: pgMockRefundMock,
          },
        },
        {
          provide: TossPaymentsClient,
          useValue: { confirm: tossConfirmMock, cancel: tossCancelMock },
        },
        {
          provide: DataSource,
          useValue: {
            manager,
            transaction: (work: (m: typeof manager) => Promise<unknown>) =>
              work(manager),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentServiceService>(PaymentServiceService);
  });

  describe('refundPayment (LDP-28 환불)', () => {
    const refundKey = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const approved = {
      paymentId: 7,
      reservationId: 1,
      pgOrderId: 'rsv1-abc',
      amount: 50000,
      provider: PaymentProvider.MOCK,
      paymentKey: 'pgmock_1',
      status: PaymentStatus.APPROVED,
      refundIdempotencyKey: null,
      rawResponse: { approvalNumber: '123' },
    };
    const originalProvider = process.env.PAYMENT_PROVIDER;

    beforeEach(() => {
      repoUpdateMock.mockResolvedValue({ affected: 1 });
      managerUpdateMock.mockResolvedValue({ affected: 1 });
      managerInsertMock.mockResolvedValue({});
    });

    afterAll(() => {
      process.env.PAYMENT_PROVIDER = originalProvider;
    });

    it('승인된 결제가 없으면 아무것도 하지 않는다 (NO_PAYMENT)', async () => {
      findOneMock.mockResolvedValue(null);

      const result = await service.refundPayment({
        reservationId: 1,
        refundIdempotencyKey: refundKey,
      });

      expect(result).toEqual({ refunded: false, status: 'NO_PAYMENT' });
      expect(pgMockRefundMock).not.toHaveBeenCalled();
    });

    it('APPROVED -> REFUND_REQUESTED(조건부, 환불 키 기록) -> PG 취소 -> REFUNDED + outbox(PAYMENT_REFUNDED)', async () => {
      findOneMock.mockResolvedValue(approved);
      pgMockRefundMock.mockResolvedValue({
        outcome: 'CANCELED',
        canceledAt: new Date('2026-10-15T02:00:00.000Z'),
      });

      const result = await service.refundPayment({
        reservationId: 1,
        refundIdempotencyKey: refundKey,
      });

      expect(result).toEqual({
        refunded: true,
        status: PaymentStatus.REFUNDED,
      });
      expect(repoUpdateMock).toHaveBeenCalledWith(
        { paymentId: 7, status: expect.anything() as unknown },
        {
          status: PaymentStatus.REFUND_REQUESTED,
          refundIdempotencyKey: refundKey,
        },
      );
      expect(pgMockRefundMock).toHaveBeenCalledWith('pgmock_1', '예약 취소');
      expect(managerUpdateMock).toHaveBeenCalledWith(
        Payment,
        { paymentId: 7, status: PaymentStatus.REFUND_REQUESTED },
        expect.objectContaining({ status: PaymentStatus.REFUNDED }),
      );
      expect(managerInsertMock).toHaveBeenCalledWith(
        PaymentOutbox,
        expect.objectContaining({
          eventType: PaymentOutboxEventType.PAYMENT_REFUNDED,
        }),
      );
    });

    it('이미 REFUNDED면 PG를 다시 부르지 않는다 (같은 취소의 재시도)', async () => {
      findOneMock.mockResolvedValue({
        ...approved,
        status: PaymentStatus.REFUNDED,
      });

      const result = await service.refundPayment({
        reservationId: 1,
        refundIdempotencyKey: refundKey,
      });

      expect(result).toEqual({
        refunded: true,
        status: PaymentStatus.REFUNDED,
      });
      expect(repoUpdateMock).not.toHaveBeenCalled();
      expect(pgMockRefundMock).not.toHaveBeenCalled();
    });

    it('동시에 다른 요청이 먼저 상태를 바꿨으면(조건부 UPDATE 0건) PG를 부르지 않는다', async () => {
      findOneMock.mockResolvedValueOnce(approved).mockResolvedValueOnce({
        ...approved,
        status: PaymentStatus.REFUND_REQUESTED,
      });
      repoUpdateMock.mockResolvedValue({ affected: 0 });

      const result = await service.refundPayment({
        reservationId: 1,
        refundIdempotencyKey: refundKey,
      });

      expect(result.status).toBe(PaymentStatus.REFUND_REQUESTED);
      expect(pgMockRefundMock).not.toHaveBeenCalled();
    });

    it('PG 취소에 실패하면 REFUND_FAILED + outbox(PAYMENT_REFUND_FAILED), 에러는 던지지 않는다', async () => {
      findOneMock.mockResolvedValue(approved);
      pgMockRefundMock.mockResolvedValue({
        outcome: 'FAILED',
        pgCode: 'PG_MOCK_CANCEL_FAILED',
      });

      const result = await service.refundPayment({
        reservationId: 1,
        refundIdempotencyKey: refundKey,
      });

      expect(result).toEqual({
        refunded: false,
        status: PaymentStatus.REFUND_FAILED,
      });
      expect(managerUpdateMock).toHaveBeenCalledWith(
        Payment,
        { paymentId: 7, status: PaymentStatus.REFUND_REQUESTED },
        expect.objectContaining({
          status: PaymentStatus.REFUND_FAILED,
          refundedAt: null,
        }),
      );
      expect(managerInsertMock).toHaveBeenCalledWith(
        PaymentOutbox,
        expect.objectContaining({
          eventType: PaymentOutboxEventType.PAYMENT_REFUND_FAILED,
        }),
      );
    });

    it('TOSS 결제는 토스 취소 API를 환불 멱등 키와 함께 호출한다', async () => {
      findOneMock.mockResolvedValue({
        ...approved,
        provider: PaymentProvider.TOSS,
        paymentKey: 'tgen_1',
      });
      tossCancelMock.mockResolvedValue({ outcome: 'CANCELED' });

      await service.refundPayment({
        reservationId: 1,
        refundIdempotencyKey: refundKey,
      });

      expect(tossCancelMock).toHaveBeenCalledWith({
        paymentKey: 'tgen_1',
        cancelReason: '예약 취소',
        idempotencyKey: refundKey,
      });
      expect(pgMockRefundMock).not.toHaveBeenCalled();
    });

    it('REFUND_FAILED 재시도는 처음 기록한 환불 키를 그대로 쓴다 (PG가 한 번만 취소)', async () => {
      findOneMock.mockResolvedValue({
        ...approved,
        status: PaymentStatus.REFUND_FAILED,
        refundIdempotencyKey: 'first-key-0000-0000-0000-000000000000',
      });
      pgMockRefundMock.mockResolvedValue({ outcome: 'CANCELED' });

      await service.refundPayment({
        reservationId: 1,
        refundIdempotencyKey: 'other-key',
      });

      expect(repoUpdateMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          refundIdempotencyKey: 'first-key-0000-0000-0000-000000000000',
        }),
      );
    });
  });

  describe('handlePaymentWebhook (LDP-102: 기록만)', () => {
    it('웹훅을 받아도 결제내역을 만들거나 바꾸지 않는다 — 결제 → 메인 직접 호출 없음', () => {
      service.handlePaymentWebhook({
        eventType: 'PAYMENT.APPROVED',
        orderId: 'rsv1-9f2c4a7e1b3d',
        amount: 50000,
        paymentMethod: 'CARD',
        approvalNumber: '12345678',
        paymentKey: 'pk',
      });

      expect(findOneMock).not.toHaveBeenCalled();
      expect(saveMock).not.toHaveBeenCalled();
      expect(repoUpdateMock).not.toHaveBeenCalled();
      expect(managerUpdateMock).not.toHaveBeenCalled();
      expect(managerInsertMock).not.toHaveBeenCalled();
    });
  });

  // LDP-124: 결제 조회 응답의 영수증 주소 — 저장된 토스 응답(raw_response.receipt.url)에서
  describe('결제 조회 응답 receiptUrl', () => {
    it('토스 결제면 영수증 주소를 내려준다 (환불 뒤에도 그대로)', async () => {
      findOneMock.mockResolvedValue({
        paymentId: 1,
        reservationId: 1,
        approvalNumber: null,
        amount: 380000,
        paymentMethod: '간편결제 · 토스페이',
        status: PaymentStatus.REFUNDED,
        paidAt: new Date('2026-10-22T01:28:13Z'),
        userId: 1,
        rawResponse: {
          receipt: { url: 'https://dashboard.tosspayments.com/receipt/x' },
          cancel: { pgCode: undefined },
        },
      });

      const result = await service.getPaymentById(1);

      expect(result.receiptUrl).toBe(
        'https://dashboard.tosspayments.com/receipt/x',
      );
      expect(result.approvalNumber).toBe('');
    });

    it('영수증이 없으면(pg-mock 등) 빈 문자열', async () => {
      findOneMock.mockResolvedValue({
        paymentId: 2,
        reservationId: 1,
        amount: 1000,
        paymentMethod: 'CARD',
        status: PaymentStatus.APPROVED,
        paidAt: null,
        userId: 1,
        rawResponse: { approvalNumber: '123' },
      });

      expect((await service.getPaymentById(2)).receiptUrl).toBe('');
    });
  });

  describe('approvePayment', () => {
    const request = {
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      reservationId: 1,
      userId: 10,
      orderId: 'rsv1-abcdef123456',
      paymentKey: 'mock_rsv1-abcdef123456',
      amount: 50000,
      orderName: '호텔 예약 #1',
    };
    const processing = {
      paymentId: 7,
      reservationId: 1,
      pgOrderId: request.orderId,
      amount: 50000,
      provider: PaymentProvider.MOCK,
      status: PaymentStatus.PROCESSING,
    };
    const originalProvider = process.env.PAYMENT_PROVIDER;

    beforeEach(() => {
      delete process.env.PAYMENT_PROVIDER;
      createMock.mockImplementation((value: unknown) => value);
      saveMock.mockResolvedValue(processing);
      managerUpdateMock.mockResolvedValue({ affected: 1 });
      managerInsertMock.mockResolvedValue({});
    });

    afterAll(() => {
      process.env.PAYMENT_PROVIDER = originalProvider;
    });

    it('MOCK 승인이면 APPROVED로 바꾸고 같은 트랜잭션에서 outbox(PAYMENT_APPROVED)를 기록한다', async () => {
      pgMockConfirmMock.mockResolvedValue({
        outcome: 'APPROVED',
        paymentKey: 'pgmock_1',
        approvalNumber: '12345678',
        approvedAt: new Date('2026-10-15T01:00:00.000Z'),
        method: 'CARD',
      });

      const result = await service.approvePayment(request);

      expect(result).toMatchObject({ result: 'APPROVED', paymentId: 7 });
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: request.idempotencyKey,
          status: PaymentStatus.PROCESSING,
          provider: PaymentProvider.MOCK,
        }),
      );
      expect(managerUpdateMock).toHaveBeenCalledWith(
        Payment,
        { paymentId: 7, status: PaymentStatus.PROCESSING },
        expect.objectContaining({ status: PaymentStatus.APPROVED }),
      );
      expect(managerInsertMock).toHaveBeenCalledWith(
        PaymentOutbox,
        expect.objectContaining({
          eventType: PaymentOutboxEventType.PAYMENT_APPROVED,
          reservationId: 1,
          paymentId: 7,
        }),
      );
      expect(tossConfirmMock).not.toHaveBeenCalled();
    });

    it('같은 멱등 키로 다시 오면 PG를 다시 부르지 않고 기존 결과를 돌려준다', async () => {
      saveMock.mockRejectedValue(
        new QueryFailedError('INSERT', [], {
          code: 'ER_DUP_ENTRY',
          message: "Duplicate entry for key 'uk_payments_idempotency_key'",
        } as unknown as Error),
      );
      findOneMock.mockResolvedValue({
        ...processing,
        status: PaymentStatus.APPROVED,
      });

      const result = await service.approvePayment(request);

      expect(result.result).toBe('APPROVED');
      expect(pgMockConfirmMock).not.toHaveBeenCalled();
    });

    it('PG가 거절하면 FAILED(retryable)로 바꾸고 outbox(PAYMENT_FAILED)를 기록한다', async () => {
      pgMockConfirmMock.mockResolvedValue({
        outcome: 'DECLINED',
        pgCode: 'PG_MOCK_DECLINED',
        pgMessage: '결제 승인에 실패했습니다.',
      });

      const result = await service.approvePayment(request);

      expect(result).toMatchObject({
        result: 'FAILED',
        retryable: true,
        code: 'PAYMENT_DECLINED',
      });
      expect(managerInsertMock).toHaveBeenCalledWith(
        PaymentOutbox,
        expect.objectContaining({
          eventType: PaymentOutboxEventType.PAYMENT_FAILED,
        }),
      );
    });

    it('PG 결과를 알 수 없으면 UNKNOWN으로 두고 outbox는 기록하지 않는다', async () => {
      pgMockConfirmMock.mockResolvedValue({
        outcome: 'UNKNOWN',
        pgMessage: 'timeout',
      });

      const result = await service.approvePayment(request);

      expect(result.result).toBe('UNKNOWN');
      expect(managerUpdateMock).toHaveBeenCalledWith(
        Payment,
        { paymentId: 7, status: PaymentStatus.PROCESSING },
        expect.objectContaining({ status: PaymentStatus.UNKNOWN }),
      );
      expect(managerInsertMock).not.toHaveBeenCalled();
    });

    it('결과를 모를 때도 PG 결제 번호를 남긴다 — 대사 배치가 이 번호로 조회한다 (LDP-91)', async () => {
      pgMockConfirmMock.mockResolvedValue({
        outcome: 'UNKNOWN',
        paymentKey: 'pgmock_77',
        pgMessage: 'timeout',
      });

      await service.approvePayment(request);

      expect(managerUpdateMock).toHaveBeenCalledWith(
        Payment,
        { paymentId: 7, status: PaymentStatus.PROCESSING },
        expect.objectContaining({
          status: PaymentStatus.UNKNOWN,
          paymentKey: 'pgmock_77',
        }),
      );
    });

    it('결제 번호가 다른 결제와 겹치면 번호 없이라도 UNKNOWN은 남긴다', async () => {
      pgMockConfirmMock.mockResolvedValue({
        outcome: 'UNKNOWN',
        paymentKey: 'pgmock_77',
      });
      managerUpdateMock
        .mockRejectedValueOnce(
          new QueryFailedError('UPDATE', [], {
            code: 'ER_DUP_ENTRY',
          } as unknown as Error),
        )
        .mockResolvedValue({ affected: 1 });

      const result = await service.approvePayment(request);

      expect(result.result).toBe('UNKNOWN');
      expect(managerUpdateMock).toHaveBeenLastCalledWith(
        Payment,
        { paymentId: 7, status: PaymentStatus.PROCESSING },
        expect.objectContaining({
          status: PaymentStatus.UNKNOWN,
          paymentKey: null,
        }),
      );
    });

    it('MOCK에서 paymentKey가 mock_fail_로 시작하면 pg-mock에 거절을 요청한다', async () => {
      pgMockConfirmMock.mockResolvedValue({ outcome: 'DECLINED' });

      await service.approvePayment({
        ...request,
        paymentKey: 'mock_fail_rsv1-abcdef123456',
      });

      expect(pgMockConfirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ forceFail: true }),
      );
    });

    it('PAYMENT_PROVIDER=TOSS면 토스 승인 API를 멱등 키와 함께 호출한다', async () => {
      process.env.PAYMENT_PROVIDER = 'TOSS';
      tossConfirmMock.mockResolvedValue({
        outcome: 'APPROVED',
        paymentKey: 'tgen_1',
        approvedAt: new Date(),
      });

      const result = await service.approvePayment({
        ...request,
        paymentKey: 'tgen_1',
      });

      expect(result.result).toBe('APPROVED');
      expect(tossConfirmMock).toHaveBeenCalledWith({
        paymentKey: 'tgen_1',
        orderId: request.orderId,
        amount: 50000,
        idempotencyKey: request.idempotencyKey,
      });
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ provider: PaymentProvider.TOSS }),
      );
      expect(pgMockConfirmMock).not.toHaveBeenCalled();
    });

    it('같은 예약에 이미 승인된 결제가 있으면 FAILED(ALREADY_PAID)로 두고 PG 승인을 취소한다', async () => {
      pgMockConfirmMock.mockResolvedValue({
        outcome: 'APPROVED',
        paymentKey: 'pgmock_dup',
        approvedAt: new Date(),
      });
      managerUpdateMock
        .mockRejectedValueOnce(
          new QueryFailedError('UPDATE', [], {
            code: 'ER_DUP_ENTRY',
            message: "Duplicate entry '1' for key 'uk_approved_reservation'",
          } as unknown as Error),
        )
        .mockResolvedValue({ affected: 1 });
      cancelMock.mockResolvedValue({});

      const result = await service.approvePayment(request);

      expect(result).toMatchObject({
        result: 'FAILED',
        retryable: false,
        code: 'ALREADY_PAID',
      });
      expect(cancelMock).toHaveBeenCalledWith('pgmock_dup', {
        cancelReason: '중복 승인 자동 취소',
      });
    });
  });
});
