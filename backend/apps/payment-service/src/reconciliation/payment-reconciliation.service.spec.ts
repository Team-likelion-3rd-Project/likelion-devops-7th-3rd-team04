import { DataSource, Repository } from 'typeorm';
import {
  backoffSeconds,
  PaymentReconciliationService,
} from './payment-reconciliation.service';
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
} from '../entities/payment.entity';
import { PaymentServiceService } from '../payment-service.service';
import { TossPaymentsClient } from '../pg/toss-payments.client';
import { PgMockClient } from '../pg-mock/pg-mock.client';

// LDP-97: 결제 대사 배치 — 결과 불명 확정·환불 재시도
describe('PaymentReconciliationService.reconcile', () => {
  const payment = (overrides: Partial<Payment> = {}) =>
    ({
      paymentId: 1,
      reservationId: 10,
      pgOrderId: 'rsv10-abc',
      provider: PaymentProvider.TOSS,
      paymentKey: 'tgen_1',
      status: PaymentStatus.UNKNOWN,
      rawResponse: {},
      ...overrides,
    }) as Payment;

  // 대상 조회가 상태별로 돌려줄 결제 (stale: 다시 볼 때가 된 결제, expired: 만든 지 기한이 지난 결제)
  let stale: Record<string, Payment[]>;
  let expired: Record<string, Payment[]>;
  const qbStatuses: string[][] = [];
  interface FakeQueryBuilder {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
  }
  const queryBuilder = (): FakeQueryBuilder => {
    let statuses: string[] = [];
    let byCreatedAt = false;
    const qb: FakeQueryBuilder = {
      where: jest.fn((_sql: string, params: { statuses: string[] }) => {
        statuses = params.statuses;
        return qb;
      }),
      andWhere: jest.fn((sql: string) => {
        byCreatedAt ||= sql.includes('createdAt');
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getMany: jest.fn(() => {
        if (!byCreatedAt) {
          qbStatuses.push(statuses);
        }
        const source = byCreatedAt ? expired : stale;
        return Promise.resolve(statuses.flatMap((s) => source[s] ?? []));
      }),
    };
    return qb;
  };
  const repoUpdate = jest.fn();
  const query = jest.fn();
  const settleFromPgLookup = jest.fn();
  const retryRefund = jest.fn();
  const markRefundManualRequired = jest.fn();
  const markSettleManualRequired = jest.fn();
  const tossGet = jest.fn();
  const mockGet = jest.fn();
  let lockGranted: number;
  let service: PaymentReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    qbStatuses.length = 0;
    stale = {};
    expired = {};
    lockGranted = 1;
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('GET_LOCK') ? [{ ok: lockGranted }] : []),
    );
    repoUpdate.mockResolvedValue({ affected: 1 });
    tossGet.mockResolvedValue({ outcome: 'APPROVED', paymentKey: 'tgen_1' });
    mockGet.mockResolvedValue({ outcome: 'APPROVED', paymentKey: 'pgmock_1' });
    settleFromPgLookup.mockResolvedValue('APPROVED');
    retryRefund.mockResolvedValue(true);
    markRefundManualRequired.mockResolvedValue(true);
    markSettleManualRequired.mockResolvedValue(true);
    service = new PaymentReconciliationService(
      {
        createQueryBuilder: queryBuilder,
        update: repoUpdate,
      } as unknown as Repository<Payment>,
      {
        createQueryRunner: () => ({
          connect: jest.fn(),
          release: jest.fn(),
          query,
        }),
      } as unknown as DataSource,
      {
        settleFromPgLookup,
        retryRefund,
        markRefundManualRequired,
        markSettleManualRequired,
      } as unknown as PaymentServiceService,
      { getPayment: tossGet } as unknown as TossPaymentsClient,
      { getPayment: mockGet } as unknown as PgMockClient,
    );
  });

  describe('① 결과 불명 결제 확정', () => {
    it('UNKNOWN·오래된 PROCESSING을 찾아 결제 번호로 조회하고 확정한다', async () => {
      stale[PaymentStatus.UNKNOWN] = [payment()];

      const result = await service.reconcile();

      expect(qbStatuses[0]).toEqual([
        PaymentStatus.UNKNOWN,
        PaymentStatus.PROCESSING,
      ]);
      expect(tossGet).toHaveBeenCalledWith('tgen_1');
      expect(settleFromPgLookup).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 1 }),
        expect.objectContaining({ outcome: 'APPROVED' }),
      );
      expect(result).toMatchObject({ approved: 1, failed: 0, pending: 0 });
    });

    it('MOCK 결제는 pg-mock에 조회한다', async () => {
      stale[PaymentStatus.UNKNOWN] = [
        payment({ provider: PaymentProvider.MOCK, paymentKey: 'pgmock_1' }),
      ];

      await service.reconcile();

      expect(mockGet).toHaveBeenCalledWith('pgmock_1');
      expect(tossGet).not.toHaveBeenCalled();
    });

    it('실패로 확정되면 failed로 센다', async () => {
      stale[PaymentStatus.UNKNOWN] = [payment()];
      settleFromPgLookup.mockResolvedValue('FAILED');

      expect((await service.reconcile()).failed).toBe(1);
    });

    it('아직 진행 중이면 마지막 조회 결과를 남기고, 조회 횟수에 따라 간격을 늘려 다음 조회를 미룬다 (A3)', async () => {
      stale[PaymentStatus.UNKNOWN] = [payment({ reconcileAttempts: 2 })];
      tossGet.mockResolvedValue({
        outcome: 'PENDING',
        pgStatus: 'IN_PROGRESS',
      });
      settleFromPgLookup.mockResolvedValue('PENDING');

      const result = await service.reconcile();

      expect(result.pending).toBe(1);
      const [where, values] = repoUpdate.mock.calls[0] as [
        unknown,
        {
          rawResponse: unknown;
          reconcileAttempts: number;
          nextReconcileAt: () => string;
        },
      ];
      expect(where).toEqual({ paymentId: 1, status: PaymentStatus.UNKNOWN });
      expect(values.rawResponse).toEqual({
        reconcile: expect.objectContaining({
          outcome: 'PENDING',
          pgStatus: 'IN_PROGRESS',
        }) as unknown,
      });
      expect(values.reconcileAttempts).toBe(3);
      // 세 번째 조회 실패 → 2분 × 2² = 8분 뒤
      expect(values.nextReconcileAt()).toBe('NOW(6) + INTERVAL 480 SECOND');
    });

    it('기한(24시간)이 지난 결과 불명 결제는 조회하지 않고 수동 확인(UNKNOWN_MANUAL_REQUIRED)으로 옮긴다 (A3)', async () => {
      const old = payment({ paymentId: 5 });
      expired[PaymentStatus.UNKNOWN] = [old];

      const result = await service.reconcile();

      expect(markSettleManualRequired).toHaveBeenCalledWith(
        old,
        expect.stringContaining('24시간'),
      );
      expect(tossGet).not.toHaveBeenCalled();
      expect(result.settleGaveUp).toBe(1);
    });

    it('결제 번호가 없는 건의 알람은 처음 발견했을 때만 남긴다', async () => {
      const errorLog = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      stale[PaymentStatus.PROCESSING] = [
        payment({ paymentKey: null }),
        payment({
          paymentId: 2,
          paymentKey: null,
          rawResponse: { reconcile: { pgCode: 'PAYMENT_KEY_MISSING' } },
        }),
      ];

      const result = await service.reconcile();

      expect(result.noPaymentKey).toBe(2);
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('결제 번호가 없으면 조회하지 않고 알람(수동 확인)', async () => {
      stale[PaymentStatus.PROCESSING] = [payment({ paymentKey: null })];

      const result = await service.reconcile();

      expect(result.noPaymentKey).toBe(1);
      expect(tossGet).not.toHaveBeenCalled();
      expect(settleFromPgLookup).not.toHaveBeenCalled();
    });
  });

  describe('② 환불 재시도', () => {
    it('REFUND_FAILED와 오래 멈춘 REFUND_REQUESTED를 같은 환불 키로 다시 요청한다', async () => {
      stale[PaymentStatus.REFUND_FAILED] = [
        payment({
          paymentId: 2,
          status: PaymentStatus.REFUND_FAILED,
          refundIdempotencyKey: 'refund-key-2',
        }),
      ];
      stale[PaymentStatus.REFUND_REQUESTED] = [
        payment({
          paymentId: 3,
          status: PaymentStatus.REFUND_REQUESTED,
          refundIdempotencyKey: 'refund-key-3',
        }),
      ];

      const result = await service.reconcile();

      expect(retryRefund).toHaveBeenCalledTimes(2);
      expect(result.refunded).toBe(2);
    });

    it('다시 실패하면 refundFailed로 센다', async () => {
      stale[PaymentStatus.REFUND_FAILED] = [
        payment({
          status: PaymentStatus.REFUND_FAILED,
          refundIdempotencyKey: 'refund-key-1',
          rawResponse: { refundAttempts: 3 },
        }),
      ];
      retryRefund.mockResolvedValue(false);

      const result = await service.reconcile();

      expect(result.refundFailed).toBe(1);
      expect(markRefundManualRequired).not.toHaveBeenCalled();
      // 네 번째 시도까지 실패 → 2분 × 2³ = 16분 뒤 다시 (토스 장애가 길어도 10번을 30분 안에 다 쓰지 않게)
      const [where, values] = repoUpdate.mock.calls[0] as [
        unknown,
        { nextReconcileAt: () => string },
      ];
      expect(where).toEqual({
        paymentId: 1,
        status: PaymentStatus.REFUND_FAILED,
      });
      expect(values.nextReconcileAt()).toBe('NOW(6) + INTERVAL 960 SECOND');
    });

    it('최대 횟수(10번)에 닿은 환불은 더 시도하지 않고 수동 처리(REFUND_MANUAL_REQUIRED)로 옮긴다', async () => {
      const gaveUp = payment({
        status: PaymentStatus.REFUND_FAILED,
        refundIdempotencyKey: 'refund-key-1',
        rawResponse: { refundAttempts: 10 },
      });
      stale[PaymentStatus.REFUND_FAILED] = [gaveUp];

      const result = await service.reconcile();

      expect(retryRefund).not.toHaveBeenCalled();
      expect(markRefundManualRequired).toHaveBeenCalledWith(
        gaveUp,
        expect.stringContaining('10번'),
      );
      expect(result.refundGaveUp).toBe(1);
    });

    it('환불 키가 없으면 다시 시도할 수 없으므로 수동 처리로 옮긴다', async () => {
      stale[PaymentStatus.REFUND_FAILED] = [
        payment({ status: PaymentStatus.REFUND_FAILED }),
      ];

      const result = await service.reconcile();

      expect(retryRefund).not.toHaveBeenCalled();
      expect(markRefundManualRequired).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 1 }),
        '환불 키 없음',
      );
      expect(result.refundGaveUp).toBe(1);
    });

    it('포기한 환불이 대상 자리를 차지해도 새 환불 실패 건은 재시도된다 (A2)', async () => {
      // 포기 건은 수동 처리로 옮겨져 다음 조회부터 빠지고, 같은 실행 안의 다른 건도 그대로 재시도한다
      stale[PaymentStatus.REFUND_FAILED] = [
        ...Array.from({ length: 3 }, (_, i) =>
          payment({
            paymentId: 100 + i,
            status: PaymentStatus.REFUND_FAILED,
            refundIdempotencyKey: `refund-key-${i}`,
            rawResponse: { refundAttempts: 10 },
          }),
        ),
        payment({
          paymentId: 200,
          status: PaymentStatus.REFUND_FAILED,
          refundIdempotencyKey: 'refund-key-new',
          rawResponse: { refundAttempts: 1 },
        }),
      ];

      const result = await service.reconcile();

      expect(markRefundManualRequired).toHaveBeenCalledTimes(3);
      expect(retryRefund).toHaveBeenCalledTimes(1);
      expect(retryRefund).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 200 }),
      );
      expect(result).toMatchObject({ refundGaveUp: 3, refunded: 1 });
    });

    it('그 사이 다른 경로가 상태를 바꿔 수동 처리로 옮기지 못했으면 세지 않는다', async () => {
      stale[PaymentStatus.REFUND_FAILED] = [
        payment({
          status: PaymentStatus.REFUND_FAILED,
          refundIdempotencyKey: 'refund-key-1',
          rawResponse: { refundAttempts: 10 },
        }),
      ];
      markRefundManualRequired.mockResolvedValue(false);

      expect((await service.reconcile()).refundGaveUp).toBe(0);
    });
  });

  describe('실행 보호 (A1·A4)', () => {
    it('PG 호출이 5번 연달아 실패하면 이번 실행을 멈춘다 (나머지는 다음 실행에서)', async () => {
      stale[PaymentStatus.UNKNOWN] = Array.from({ length: 20 }, (_, i) =>
        payment({ paymentId: 100 + i, paymentKey: `tgen_${i}` }),
      );
      tossGet.mockResolvedValue({ outcome: 'UNKNOWN', pgCode: 'TIMEOUT' });
      settleFromPgLookup.mockResolvedValue('PENDING');

      const result = await service.reconcile();

      expect(result.stopped).toBe('PG_FAILURES');
      // 동시에 4건씩 부르므로 멈추기 전까지 시작된 호출은 5~8건
      expect(tossGet.mock.calls.length).toBeGreaterThanOrEqual(5);
      expect(tossGet.mock.calls.length).toBeLessThan(20);
      // 멈춘 뒤에는 환불 재시도도 시작하지 않는다
      expect(retryRefund).not.toHaveBeenCalled();
    });

    it('진행 중(PENDING) 응답은 PG가 응답한 것이라 멈추지 않는다', async () => {
      stale[PaymentStatus.UNKNOWN] = Array.from({ length: 10 }, (_, i) =>
        payment({ paymentId: 100 + i, paymentKey: `tgen_${i}` }),
      );
      tossGet.mockResolvedValue({ outcome: 'PENDING', pgStatus: 'READY' });
      settleFromPgLookup.mockResolvedValue('PENDING');

      const result = await service.reconcile();

      expect(result.stopped).toBeUndefined();
      expect(tossGet).toHaveBeenCalledTimes(10);
    });

    it('PG 호출은 최대 4건까지만 동시에 한다', async () => {
      stale[PaymentStatus.UNKNOWN] = Array.from({ length: 10 }, (_, i) =>
        payment({ paymentId: 100 + i, paymentKey: `tgen_${i}` }),
      );
      let inFlight = 0;
      let maxInFlight = 0;
      tossGet.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        return { outcome: 'APPROVED' };
      });

      const result = await service.reconcile();

      expect(result.approved).toBe(10);
      expect(maxInFlight).toBe(4);
    });

    it('한 건에서 예외가 나도 나머지는 계속 처리한다', async () => {
      stale[PaymentStatus.UNKNOWN] = [
        payment({ paymentId: 1 }),
        payment({ paymentId: 2, paymentKey: 'tgen_2' }),
      ];
      jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      settleFromPgLookup
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce('APPROVED');

      const result = await service.reconcile();

      expect(result).toMatchObject({ errors: 1, approved: 1 });
    });

    it('재시도 간격은 2분부터 두 배씩, 최대 1시간', () => {
      expect([1, 2, 3, 4, 5, 6, 7, 10].map(backoffSeconds)).toEqual([
        120, 240, 480, 960, 1920, 3600, 3600, 3600,
      ]);
    });
  });

  it('다른 인스턴스가 실행 중이면(GET_LOCK 실패) 아무것도 하지 않는다', async () => {
    lockGranted = 0;
    stale[PaymentStatus.UNKNOWN] = [payment()];

    const result = await service.reconcile();

    expect(result.skipped).toBe(true);
    expect(tossGet).not.toHaveBeenCalled();
  });

  it('끝나면 잠금을 푼다', async () => {
    await service.reconcile();

    expect(query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', [
      'payment:reconciliation',
    ]);
  });
});
