import { of, throwError } from 'rxjs';
import { DataSource, Repository } from 'typeorm';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';
import { RefundRequestWorker } from './refund-request.worker';

// LDP-97: 환불 요청 대기열(pending_refunds) — 결제 서비스에 전달될 때까지 재시도
describe('환불 요청 대기열 (pending_refunds)', () => {
  const query = jest.fn();
  const managerUpdate = jest.fn();
  const managerQuery = jest.fn();
  const manager = { update: managerUpdate, query: managerQuery };
  const refundPayment = jest.fn();
  const releaseRoomAvailability = jest.fn();
  const reservationFindOne = jest.fn();
  const dataSource = {
    query,
    transaction: (work: (m: typeof manager) => Promise<unknown>) =>
      work(manager),
  } as unknown as DataSource;
  let service: BookingServiceService;

  const sqlCalls = () => query.mock.calls.map(([sql]) => String(sql));

  beforeEach(() => {
    jest.clearAllMocks();
    managerUpdate.mockResolvedValue({ affected: 1 });
    managerQuery.mockResolvedValue({});
    releaseRoomAvailability.mockReturnValue(of({ success: true }));
    refundPayment.mockReturnValue(of({ refunded: true, status: 'REFUNDED' }));
    service = new BookingServiceService(
      { findOne: reservationFindOne } as unknown as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      dataSource,
      {} as ReservationFacilityService,
      { getService: () => ({ releaseRoomAvailability }) } as never,
      { getService: () => ({ refundPayment }) } as never,
    );
    service.onModuleInit();
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('deliverRefund', () => {
    it('맡은 뒤(lease) 기한을 걸어 결제 서비스에 요청하고, 응답을 받으면 끝낸다', async () => {
      query
        .mockResolvedValueOnce({ affectedRows: 1 }) // 맡기
        .mockResolvedValue({}); // 완료 기록

      expect(await service.deliverRefund(1)).toBe('DELIVERED');

      expect(sqlCalls()[0]).toContain(
        'next_attempt_at = NOW(6) + INTERVAL 60 SECOND',
      );
      expect(refundPayment).toHaveBeenCalledWith(
        {
          reservationId: 1,
          refundIdempotencyKey: expect.any(String) as string,
        },
        expect.anything(),
        { deadline: expect.any(Date) as Date },
      );
      expect(sqlCalls()[1]).toContain('SET completed_at = NOW(6)');
    });

    it('환불 실패(REFUND_FAILED)로 응답해도 요청은 전달된 것 — 재시도는 결제 쪽 대사 배치가 맡는다', async () => {
      query.mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValue({});
      refundPayment.mockReturnValue(
        of({ refunded: false, status: 'REFUND_FAILED' }),
      );

      expect(await service.deliverRefund(1)).toBe('DELIVERED');
    });

    it('결제 서비스 호출이 실패하면 횟수를 올리고 간격을 늘려 다시 요청할 시각을 정한다 (유실 없음)', async () => {
      query
        .mockResolvedValueOnce({ affectedRows: 1 }) // 맡기
        .mockResolvedValueOnce([{ attempts: 2 }]) // 지금까지 실패 횟수
        .mockResolvedValue({});
      refundPayment.mockReturnValue(
        throwError(() => new Error('DEADLINE_EXCEEDED')),
      );

      expect(await service.deliverRefund(1)).toBe('RETRY');

      const [sql, params] = query.mock.calls[2] as [string, unknown[]];
      // 세 번째 실패 → 30초 × 2² = 120초 뒤
      expect(sql).toContain('NOW(6) + INTERVAL 120 SECOND');
      expect(params).toEqual([3, 'DEADLINE_EXCEEDED', 1]);
      expect(sqlCalls().some((s) => s.includes('completed_at = NOW(6)'))).toBe(
        false,
      );
    });

    it('다른 곳이 처리 중이거나 이미 끝났으면(맡지 못함) 부르지 않는다', async () => {
      query.mockResolvedValueOnce({ affectedRows: 0 });

      expect(await service.deliverRefund(1)).toBe('SKIPPED');
      expect(refundPayment).not.toHaveBeenCalled();
    });
  });

  describe('cancelReservation', () => {
    const reservation = () =>
      ({
        reservationId: 1,
        roomId: 2,
        checkInDate: '2026-10-20',
        checkOutDate: '2026-10-21',
        status: ReservationStatus.RESERVED,
      }) as Reservation;

    it('취소와 "환불 필요" 기록을 한 트랜잭션으로 남기고, 커밋 뒤 바로 한 번 요청한다', async () => {
      query.mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValue({});

      expect(await service.cancelReservation(reservation())).toBe(true);

      expect(managerUpdate).toHaveBeenCalledWith(
        Reservation,
        expect.objectContaining({ reservationId: 1 }),
        expect.objectContaining({ status: ReservationStatus.CANCELLED }),
      );
      expect(managerQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pending_refunds'),
        [1, 'CANCELLED'],
      );
      expect(refundPayment).toHaveBeenCalledTimes(1);
    });

    it('결제 서비스 호출이 실패해도 취소는 유지되고, 환불 요청은 대기열에 남는다', async () => {
      query
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ attempts: 0 }])
        .mockResolvedValue({});
      refundPayment.mockReturnValue(throwError(() => new Error('UNAVAILABLE')));

      expect(await service.cancelReservation(reservation())).toBe(true);
      expect(sqlCalls().some((s) => s.includes('SET attempts = ?'))).toBe(true);
    });

    it('그 사이 상태가 바뀌어 취소하지 못했으면 환불도 남기지 않는다', async () => {
      managerUpdate.mockResolvedValue({ affected: 0 });

      expect(await service.cancelReservation(reservation())).toBe(false);
      expect(managerQuery).not.toHaveBeenCalled();
      expect(refundPayment).not.toHaveBeenCalled();
    });
  });

  describe('RefundRequestWorker', () => {
    it('요청할 때가 된 건을 하나씩 전달하고 결과를 센다', async () => {
      const deliverRefund = jest
        .fn()
        .mockResolvedValueOnce('DELIVERED')
        .mockResolvedValueOnce('RETRY')
        .mockResolvedValueOnce('SKIPPED');
      const workerQuery = jest
        .fn()
        .mockResolvedValue([
          { reservation_id: 1 },
          { reservation_id: 2 },
          { reservation_id: 3 },
        ]);
      const worker = new RefundRequestWorker(
        { query: workerQuery } as unknown as DataSource,
        { deliverRefund } as unknown as BookingServiceService,
      );

      const result = await worker.processDue();

      const [[selectSql]] = workerQuery.mock.calls as [string][];
      expect(selectSql).toContain(
        'completed_at IS NULL AND next_attempt_at <= NOW(6)',
      );
      expect(deliverRefund.mock.calls).toEqual([[1], [2], [3]]);
      expect(result).toEqual({ delivered: 1, retry: 1 });
    });
  });
});
