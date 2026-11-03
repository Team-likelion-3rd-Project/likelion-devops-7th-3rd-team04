import { status as GrpcStatus } from '@grpc/grpc-js';
import { DataSource, Repository } from 'typeorm';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// 손님 예약 취소(cancelBooking) — 진행 중인 예약을 취소하는 경로.
// 취소 1건의 내부 처리(트랜잭션·환불 대기열)와 이미 끝난 예약 재취소(환불 상태 안내)는 refund-request.spec.ts에서 본다.
describe('BookingServiceService', () => {
  const reservationFindOne = jest.fn();
  let service: BookingServiceService;
  let cancelReservation: jest.SpyInstance;
  let cancelLinkedExtensions: jest.SpyInstance;

  const reservation = (overrides: Partial<Reservation> = {}) =>
    ({
      reservationId: 1,
      userId: 10,
      roomId: 2,
      checkInDate: '2026-11-10',
      checkOutDate: '2026-11-12',
      status: ReservationStatus.PENDING_PAYMENT,
      ...overrides,
    }) as Reservation;

  // gRPC 오류의 상태 코드
  const grpcCodeOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return (error as { getError?: () => { code?: number } }).getError?.()?.code;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BookingServiceService(
      { findOne: reservationFindOne } as unknown as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      {} as DataSource,
      {} as ReservationFacilityService,
      { getService: () => ({}) } as never,
      { getService: () => ({}) } as never,
    );
    service.onModuleInit();
    cancelReservation = jest
      .spyOn(service, 'cancelReservation')
      .mockImplementation((target: Reservation) => {
        target.status = ReservationStatus.CANCELLED;
        return Promise.resolve(true);
      });
    cancelLinkedExtensions = jest
      .spyOn(service, 'cancelLinkedExtensions')
      .mockResolvedValue(undefined);
  });

  describe('cancelBooking', () => {
    it.each([ReservationStatus.PENDING_PAYMENT, ReservationStatus.RESERVED])(
      '%s 예약은 취소하고 취소된 예약을 돌려준다',
      async (status) => {
        reservationFindOne.mockResolvedValue(reservation({ status }));

        const result = await service.cancelBooking(1, 10);

        expect(cancelReservation).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
          reservationId: 1,
          status: ReservationStatus.CANCELLED,
        });
      },
    );

    it('원래 예약을 취소하면 연결된 연장 예약도 함께 취소한다', async () => {
      reservationFindOne.mockResolvedValue(reservation());

      await service.cancelBooking(1, 10);

      expect(cancelLinkedExtensions).toHaveBeenCalledWith(1);
    });

    it('연장 예약만 취소하면 원래 예약은 건드리지 않는다', async () => {
      reservationFindOne.mockResolvedValue(
        reservation({ linkedReservationId: 7 }),
      );

      await service.cancelBooking(1, 10);

      expect(cancelLinkedExtensions).not.toHaveBeenCalled();
    });

    it('없는 예약이면 NOT_FOUND', async () => {
      reservationFindOne.mockResolvedValue(null);

      expect(await grpcCodeOf(service.cancelBooking(1, 10))).toBe(
        GrpcStatus.NOT_FOUND,
      );
      expect(cancelReservation).not.toHaveBeenCalled();
    });

    it('본인의 예약이 아니면 PERMISSION_DENIED', async () => {
      reservationFindOne.mockResolvedValue(reservation({ userId: 999 }));

      expect(await grpcCodeOf(service.cancelBooking(1, 10))).toBe(
        GrpcStatus.PERMISSION_DENIED,
      );
      expect(cancelReservation).not.toHaveBeenCalled();
    });

    it('확인한 뒤 그 사이 상태가 바뀌어 취소하지 못했으면 FAILED_PRECONDITION', async () => {
      reservationFindOne.mockResolvedValue(reservation());
      cancelReservation.mockResolvedValue(false);

      expect(await grpcCodeOf(service.cancelBooking(1, 10))).toBe(
        GrpcStatus.FAILED_PRECONDITION,
      );
      expect(cancelLinkedExtensions).not.toHaveBeenCalled();
    });
  });
});
