import { of, throwError } from 'rxjs';
import { DataSource, IsNull, Repository } from 'typeorm';
import { parseApiRpcError } from '@app/common';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import {
  PaymentAttempt,
  PaymentAttemptStatus,
} from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// LDP-67: 결제 시도 "승인 확인 중"(CONFIRMING)과 "결제 준비만 함"(REQUESTED) 구분
describe('BookingServiceService 결제 시도 상태 (CONFIRMING)', () => {
  const reservationFind = jest.fn();
  const reservationFindOne = jest.fn();
  const attemptFind = jest.fn();
  const attemptFindOne = jest.fn();
  const attemptUpdate = jest.fn();
  const attemptCount = jest.fn();
  const approvePayment = jest.fn();
  let service: BookingServiceService;

  const MINUTE = 60_000;
  // "승인 요청 시각에 아무 Date나 들어감"을 확인하는 matcher
  const anyDate = expect.any(Date) as unknown as Date;
  const reservation = {
    reservationId: 1,
    userId: 10,
    status: ReservationStatus.PENDING_PAYMENT,
    totalAmount: 100000,
    paymentDueAt: new Date(Date.now() + 30 * MINUTE),
  };
  const attempt = (overrides: Partial<PaymentAttempt> = {}) => ({
    attemptId: '3',
    reservationId: 1,
    idempotencyKey: 'key-1',
    pgOrderId: 'rsv1-abc',
    amount: 100000,
    status: PaymentAttemptStatus.REQUESTED,
    confirmRequestedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    attemptUpdate.mockResolvedValue({ affected: 1 });
    service = new BookingServiceService(
      {
        find: reservationFind,
        findOne: reservationFindOne,
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      } as unknown as Repository<Reservation>,
      {
        find: attemptFind,
        findOne: attemptFindOne,
        update: attemptUpdate,
        count: attemptCount,
      } as unknown as Repository<PaymentAttempt>,
      {} as DataSource,
      {} as ReservationFacilityService,
      { getService: () => ({}) } as never,
      { getService: () => ({ approvePayment }) } as never,
    );
    service.onModuleInit();
  });

  describe('예약 응답의 lastPaymentAttemptStatus', () => {
    const lastStatusOf = async (latest: Partial<PaymentAttempt>) => {
      reservationFind.mockResolvedValue([reservation]);
      attemptFind.mockResolvedValue([attempt(latest)]);
      const [booking] = await service.getBookingsByUserId(10);
      return booking.lastPaymentAttemptStatus;
    };

    it('결제 준비만 하고 승인 요청을 안 보냈으면 REQUESTED', async () => {
      expect(await lastStatusOf({ confirmRequestedAt: null })).toBe(
        'REQUESTED',
      );
    });

    it('승인 요청 후 결과가 확정되지 않았으면 CONFIRMING', async () => {
      expect(
        await lastStatusOf({
          confirmRequestedAt: new Date(Date.now() - 1 * MINUTE),
        }),
      ).toBe('CONFIRMING');
    });

    it('승인 요청 후 10분이 지나도 확정되지 않으면 REQUESTED (재결제 허용)', async () => {
      expect(
        await lastStatusOf({
          confirmRequestedAt: new Date(Date.now() - 11 * MINUTE),
        }),
      ).toBe('REQUESTED');
    });

    it('결과가 확정되면 승인 요청 시각과 관계없이 SUCCEEDED / FAILED', async () => {
      const recent = new Date(Date.now() - 1 * MINUTE);
      expect(
        await lastStatusOf({
          status: PaymentAttemptStatus.SUCCEEDED,
          confirmRequestedAt: recent,
        }),
      ).toBe('SUCCEEDED');
      expect(
        await lastStatusOf({
          status: PaymentAttemptStatus.FAILED,
          confirmRequestedAt: recent,
        }),
      ).toBe('FAILED');
    });
  });

  describe('confirmPayment', () => {
    const confirm = () =>
      service.confirmPayment({
        reservationId: 1,
        userId: 10,
        paymentKey: 'pk',
        orderId: 'rsv1-abc',
        amount: 100000,
      });

    beforeEach(() => {
      reservationFindOne.mockResolvedValue(reservation);
      attemptFindOne.mockResolvedValue(attempt());
    });

    it('payment-service에 승인을 요청하기 전에 승인 요청 시각을 기록한다 (비어 있을 때만)', async () => {
      approvePayment.mockImplementation(() => {
        // 승인 요청 시점에는 이미 기록돼 있어야 한다
        expect(attemptUpdate).toHaveBeenCalledWith(
          {
            attemptId: '3',
            status: PaymentAttemptStatus.REQUESTED,
            confirmRequestedAt: IsNull(),
          },
          { confirmRequestedAt: anyDate },
        );
        return of({ result: 'UNKNOWN', message: '' });
      });

      const result = await confirm();

      expect(approvePayment).toHaveBeenCalledTimes(1);
      expect(result.result).toBe('UNKNOWN');
    });

    it('payment-service 호출이 실패해도 승인 요청 시각은 남는다 (돈이 빠졌을 수도 있음)', async () => {
      approvePayment.mockReturnValue(throwError(() => new Error('timeout')));

      const result = await confirm();

      expect(result.result).toBe('UNKNOWN');
      expect(attemptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ attemptId: '3' }),
        { confirmRequestedAt: anyDate },
      );
    });

    it('금액이 다르면 승인 요청을 보내지 않으므로 승인 요청 시각도 남기지 않는다', async () => {
      const error = await service
        .confirmPayment({
          reservationId: 1,
          userId: 10,
          paymentKey: 'pk',
          orderId: 'rsv1-abc',
          amount: 1,
        })
        .catch((e: unknown) => e);

      expect(parseApiRpcError(error)?.code).toBe('AMOUNT_MISMATCH');
      expect(approvePayment).not.toHaveBeenCalled();
      expect(attemptUpdate).not.toHaveBeenCalledWith(expect.anything(), {
        confirmRequestedAt: anyDate,
      });
    });
  });
});
