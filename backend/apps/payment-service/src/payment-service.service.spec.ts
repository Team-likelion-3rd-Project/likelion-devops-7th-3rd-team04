import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
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

  const getBookingByIdMock = jest.fn();
  const confirmBookingMock = jest.fn();
  const createAndApproveMock = jest.fn();
  const cancelMock = jest.fn();
  const findOneMock = jest.fn();
  const createMock = jest.fn();
  const saveMock = jest.fn();
  const pgMockConfirmMock = jest.fn();
  const tossConfirmMock = jest.fn();
  // 트랜잭션 안에서 쓰는 EntityManager 대역 — update/insert 호출을 확인한다
  const managerUpdateMock = jest.fn();
  const managerInsertMock = jest.fn();
  const manager = { update: managerUpdateMock, insert: managerInsertMock };

  const pendingPaymentBooking = {
    reservationId: 1,
    userId: 10,
    totalAmount: 50000,
    status: 'PENDING_PAYMENT',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    confirmBookingMock.mockReturnValue(
      of({ reservationId: 1, status: 'RESERVED' }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentServiceService,
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            findOne: findOneMock,
            create: createMock,
            save: saveMock,
          },
        },
        {
          provide: 'BOOKING_SERVICE',
          useValue: {
            getService: () => ({
              getBookingById: getBookingByIdMock,
              confirmBooking: confirmBookingMock,
            }),
          },
        },
        {
          provide: PgMockClient,
          useValue: {
            createAndApprove: createAndApproveMock,
            cancel: cancelMock,
            confirm: pgMockConfirmMock,
          },
        },
        {
          provide: TossPaymentsClient,
          useValue: { confirm: tossConfirmMock },
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
    service.onModuleInit();
  });

  it('정상 결제 요청을 처리하고 결제내역을 저장한다', async () => {
    getBookingByIdMock.mockReturnValue(of(pendingPaymentBooking));
    findOneMock.mockResolvedValue(null);
    createAndApproveMock.mockResolvedValue({
      approvalNumber: '12345678',
      approvedAt: '2026-08-18T02:00:05.000Z',
    });
    createMock.mockReturnValue({});
    saveMock.mockResolvedValue({
      paymentId: 1,
      reservationId: 1,
      approvalNumber: '12345678',
      amount: 50000,
      paymentMethod: 'CARD',
      status: PaymentStatus.APPROVED,
      paidAt: new Date('2026-08-18T02:00:05.000Z'),
    });

    const result = await service.requestPayment({
      reservationId: 1,
      userId: 10,
      paymentMethod: 'CARD',
    });

    expect(createAndApproveMock).toHaveBeenCalledWith({
      orderId: '1',
      amount: 50000,
      orderName: '예약 #1 결제',
      paymentMethod: 'CARD',
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.any(String) as string,
        pgOrderId: '1',
        provider: PaymentProvider.MOCK,
        status: PaymentStatus.APPROVED,
      }),
    );
    expect(result.status).toBe(PaymentStatus.APPROVED);
    expect(result.approvalNumber).toBe('12345678');
    expect(confirmBookingMock).toHaveBeenCalledWith({ reservationId: 1 });
  });

  it('존재하지 않는 예약이면 RpcException을 던진다', async () => {
    getBookingByIdMock.mockReturnValue(
      throwError(() => new Error('not found')),
    );

    await expect(
      service.requestPayment({
        reservationId: 999,
        userId: 10,
        paymentMethod: 'CARD',
      }),
    ).rejects.toThrow(RpcException);
  });

  it('본인의 예약이 아니면 RpcException을 던진다', async () => {
    getBookingByIdMock.mockReturnValue(
      of({ ...pendingPaymentBooking, userId: 999 }),
    );

    await expect(
      service.requestPayment({
        reservationId: 1,
        userId: 10,
        paymentMethod: 'CARD',
      }),
    ).rejects.toThrow(RpcException);
  });

  it('PENDING_PAYMENT 상태가 아니면 RpcException을 던진다', async () => {
    getBookingByIdMock.mockReturnValue(
      of({ ...pendingPaymentBooking, status: 'CANCELLED' }),
    );

    await expect(
      service.requestPayment({
        reservationId: 1,
        userId: 10,
        paymentMethod: 'CARD',
      }),
    ).rejects.toThrow(RpcException);
  });

  it('이미 결제된 예약이면 RpcException을 던진다', async () => {
    getBookingByIdMock.mockReturnValue(of(pendingPaymentBooking));
    findOneMock.mockResolvedValue({ paymentId: 1 });

    await expect(
      service.requestPayment({
        reservationId: 1,
        userId: 10,
        paymentMethod: 'CARD',
      }),
    ).rejects.toThrow(RpcException);
  });

  it('PG 승인 실패 시 RpcException이 그대로 전파된다', async () => {
    getBookingByIdMock.mockReturnValue(of(pendingPaymentBooking));
    findOneMock.mockResolvedValue(null);
    createAndApproveMock.mockRejectedValue(
      new RpcException('결제 승인에 실패했습니다.'),
    );

    await expect(
      service.requestPayment({
        reservationId: 1,
        userId: 10,
        paymentMethod: 'CARD',
      }),
    ).rejects.toThrow(RpcException);
  });

  it('예약 확정(ConfirmBooking) 호출이 실패해도 결제 요청 자체는 성공 처리한다', async () => {
    getBookingByIdMock.mockReturnValue(of(pendingPaymentBooking));
    findOneMock.mockResolvedValue(null);
    createAndApproveMock.mockResolvedValue({
      paymentKey: 'pgmock_1',
      approvalNumber: '12345678',
      approvedAt: '2026-08-18T02:00:05.000Z',
    });
    createMock.mockReturnValue({});
    saveMock.mockResolvedValue({
      paymentId: 1,
      reservationId: 1,
      approvalNumber: '12345678',
      amount: 50000,
      paymentMethod: 'CARD',
      status: PaymentStatus.APPROVED,
      paidAt: new Date('2026-08-18T02:00:05.000Z'),
    });
    confirmBookingMock.mockReturnValue(
      throwError(() => new RpcException('예약 확정 실패')),
    );

    const result = await service.requestPayment({
      reservationId: 1,
      userId: 10,
      paymentMethod: 'CARD',
    });

    expect(result.status).toBe(PaymentStatus.APPROVED);
  });

  describe('refundPayment', () => {
    it('APPROVED 결제가 있으면 PG 취소를 요청하고 결제내역을 REFUNDED로 바꾼다', async () => {
      const paid = {
        paymentId: 1,
        paymentKey: 'pgmock_1',
        status: PaymentStatus.APPROVED,
      };
      findOneMock.mockResolvedValue(paid);
      cancelMock.mockResolvedValue({});
      saveMock.mockResolvedValue({ ...paid, status: PaymentStatus.REFUNDED });

      const result = await service.refundPayment(1);

      expect(cancelMock).toHaveBeenCalledWith('pgmock_1', {
        cancelReason: '예약 취소',
      });
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.REFUNDED }),
      );
      expect(result).toEqual({ refunded: true });
    });

    it('APPROVED 결제가 없으면 아무것도 하지 않는다(no-op)', async () => {
      findOneMock.mockResolvedValue(null);

      const result = await service.refundPayment(1);

      expect(cancelMock).not.toHaveBeenCalled();
      expect(saveMock).not.toHaveBeenCalled();
      expect(result).toEqual({ refunded: false });
    });
  });

  describe('handlePaymentWebhook', () => {
    const webhookBase = {
      eventType: 'PAYMENT.APPROVED',
      orderId: '1',
      amount: 50000,
      paymentMethod: 'CARD',
      approvalNumber: '12345678',
      paymentKey: 'pgmock_1',
    };

    it('APPROVED 웹훅인데 이미 결제내역이 있으면 무시한다(중복 생성 방지)', async () => {
      findOneMock.mockResolvedValue({ paymentId: 1 });

      await service.handlePaymentWebhook(webhookBase);

      expect(createMock).not.toHaveBeenCalled();
    });

    it('APPROVED 웹훅인데 결제내역이 없으면 새로 생성한다(동기 흐름 구제)', async () => {
      findOneMock.mockResolvedValue(null);
      createMock.mockReturnValue({});
      saveMock.mockResolvedValue({ paymentId: 1 });

      await service.handlePaymentWebhook(webhookBase);

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationId: 1,
          approvalNumber: '12345678',
          amount: 50000,
          paymentMethod: 'CARD',
          status: PaymentStatus.APPROVED,
        }),
      );
      expect(saveMock).toHaveBeenCalled();
    });

    it('CANCELED 웹훅이고 결제내역이 있으면 REFUNDED로 바꾼다', async () => {
      const existing = { paymentId: 1, status: PaymentStatus.APPROVED };
      findOneMock.mockResolvedValue(existing);
      saveMock.mockResolvedValue({
        ...existing,
        status: PaymentStatus.REFUNDED,
      });

      await service.handlePaymentWebhook({
        ...webhookBase,
        eventType: 'PAYMENT.CANCELED',
      });

      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaymentStatus.REFUNDED }),
      );
    });

    it('CANCELED 웹훅인데 대응하는 결제내역이 없으면 아무것도 하지 않는다', async () => {
      findOneMock.mockResolvedValue(null);

      await service.handlePaymentWebhook({
        ...webhookBase,
        eventType: 'PAYMENT.CANCELED',
      });

      expect(saveMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });

    it('orderId가 숫자가 아니면 아무것도 하지 않는다', async () => {
      await service.handlePaymentWebhook({
        ...webhookBase,
        orderId: 'not-a-number',
      });

      expect(findOneMock).not.toHaveBeenCalled();
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
