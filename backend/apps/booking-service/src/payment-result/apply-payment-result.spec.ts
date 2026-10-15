import { of } from 'rxjs';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { PaymentResultEvent } from '@app/common';
import { BookingServiceService } from '../booking-service.service';
import { Reservation, ReservationStatus } from '../entities/reservation.entity';
import {
  PaymentAttempt,
  PaymentAttemptStatus,
} from '../entities/payment-attempt.entity';
import { PaymentResultInbox } from '../entities/payment-result-inbox.entity';
import { ReservationFacilityService } from '../reservation-facility.service';

describe('BookingServiceService.applyPaymentResult (결제 결과 이벤트 반영)', () => {
  const managerFindOne = jest.fn();
  const managerSave = jest.fn();
  const managerUpdate = jest.fn();
  const manager = {
    findOne: managerFindOne,
    save: managerSave,
    create: (_entity: unknown, value: unknown) => value,
    update: managerUpdate,
  };
  const setRoomAvailability = jest.fn();
  let service: BookingServiceService;

  const attempt = { attemptId: '3', reservationId: 1, pgOrderId: 'rsv1-abc' };
  const reservation = {
    reservationId: 1,
    roomId: 2,
    checkInDate: '2026-10-20',
    checkOutDate: '2026-10-21',
  };
  const event = (
    overrides: Partial<PaymentResultEvent> = {},
  ): PaymentResultEvent => ({
    eventId: 'e1',
    eventType: 'PAYMENT_APPROVED',
    reservationId: 1,
    paymentId: 7,
    orderId: 'rsv1-abc',
    amount: 100000,
    retryable: false,
    occurredAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    managerSave.mockResolvedValue({});
    managerUpdate.mockResolvedValue({ affected: 1 });
    setRoomAvailability.mockReturnValue(of({ success: true }));
    const dataSource = {
      transaction: (work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
    } as unknown as DataSource;
    service = new BookingServiceService(
      {} as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      dataSource,
      {} as ReservationFacilityService,
      { getService: () => ({ setRoomAvailability }) } as never,
      { getService: () => ({}) } as never,
    );
    service.onModuleInit();
  });

  it('PAYMENT_APPROVED: inbox 기록 + 시도 SUCCEEDED + 예약 PENDING_PAYMENT→RESERVED (조건부) + 처리 시각', async () => {
    managerFindOne.mockResolvedValueOnce(attempt);

    await service.applyPaymentResult(event());

    expect(managerSave).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'e1', attemptId: '3', paymentId: 7 }),
    );
    expect(managerUpdate).toHaveBeenCalledWith(
      PaymentAttempt,
      { attemptId: '3', status: PaymentAttemptStatus.REQUESTED },
      { status: PaymentAttemptStatus.SUCCEEDED },
    );
    expect(managerUpdate).toHaveBeenCalledWith(
      Reservation,
      { reservationId: 1, status: ReservationStatus.PENDING_PAYMENT },
      { status: ReservationStatus.RESERVED },
    );
    expect(managerUpdate).toHaveBeenCalledWith(
      PaymentResultInbox,
      { eventId: 'e1' },
      { processedAt: expect.any(Date) as Date },
    );
  });

  it('같은 event_id가 다시 오면(UNIQUE 위반) 아무 상태도 바꾸지 않는다', async () => {
    managerFindOne.mockResolvedValueOnce(attempt);
    managerSave.mockRejectedValueOnce(
      new QueryFailedError('INSERT', [], {
        code: 'ER_DUP_ENTRY',
      } as unknown as Error),
    );

    await service.applyPaymentResult(event());

    expect(managerUpdate).not.toHaveBeenCalled();
  });

  it('PAYMENT_FAILED + retryable=false: 시도 FAILED + 예약 PAYMENT_FAILED + 재고 반환', async () => {
    managerFindOne
      .mockResolvedValueOnce(attempt) // 시도 조회
      .mockResolvedValueOnce(reservation); // 재고 반환할 예약 조회

    await service.applyPaymentResult(
      event({ eventType: 'PAYMENT_FAILED', retryable: false }),
    );

    expect(managerUpdate).toHaveBeenCalledWith(
      Reservation,
      { reservationId: 1, status: ReservationStatus.PENDING_PAYMENT },
      { status: ReservationStatus.PAYMENT_FAILED },
    );
    expect(setRoomAvailability).toHaveBeenCalledWith({
      roomId: 2,
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      isAvailable: true,
    });
  });

  it('PAYMENT_FAILED + retryable=true: 시도만 FAILED, 예약은 그대로', async () => {
    managerFindOne.mockResolvedValueOnce(attempt);

    await service.applyPaymentResult(
      event({ eventType: 'PAYMENT_FAILED', retryable: true }),
    );

    expect(managerUpdate).not.toHaveBeenCalledWith(
      Reservation,
      expect.anything(),
      expect.anything(),
    );
    expect(setRoomAvailability).not.toHaveBeenCalled();
  });

  it('승인 이벤트인데 예약이 이미 취소됐으면 에러 없이 알람 로그만 남긴다 (환불 필요)', async () => {
    managerFindOne
      .mockResolvedValueOnce(attempt)
      .mockResolvedValueOnce({ status: ReservationStatus.CANCELLED });
    managerUpdate
      .mockResolvedValueOnce({ affected: 1 }) // 시도 SUCCEEDED
      .mockResolvedValueOnce({ affected: 0 }) // 예약 조건부 UPDATE 실패
      .mockResolvedValue({ affected: 1 });
    const errorLog = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(service.applyPaymentResult(event())).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('환불 필요'));
  });
});
