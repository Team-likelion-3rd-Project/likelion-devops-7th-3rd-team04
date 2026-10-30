import { DataSource, Repository } from 'typeorm';
import { throwError } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { BookingServiceService } from './booking-service.service';
import { Reservation } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// LDP-198: 손님 예약에서 재고 확보(hotel-service) 실패를 매진·없는 객실·장애로 나눈다.
// 예전에는 관리자 예약만 연결 실패를 503으로 구분하고, 손님 예약은 전부 매진(409)으로 보였다.
describe('createBooking — 재고 확보 실패', () => {
  const reserveRoomAvailability = jest.fn();
  const save = jest.fn();
  let service: BookingServiceService;

  const request = {
    userId: 10,
    roomId: 1,
    hotelId: 1,
    checkInDate: '2026-09-01',
    checkOutDate: '2026-09-03',
    guestCount: 2,
  };

  const failWith = async (err: object) => {
    reserveRoomAvailability.mockReturnValue(throwError(() => err));
    const thrown = (await service
      .createBooking(request)
      .catch((e: unknown) => e)) as RpcException;
    expect(save).not.toHaveBeenCalled();
    return thrown.getError();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BookingServiceService(
      { save } as unknown as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      {} as DataSource,
      {} as ReservationFacilityService,
      { getService: () => ({ reserveRoomAvailability }) } as never,
      { getService: () => ({}) } as never,
    );
    service.onModuleInit();
  });

  it('매진(FAILED_PRECONDITION)이면 FAILED_PRECONDITION(→ 409)과 hotel-service 메시지', async () => {
    expect(
      await failWith({
        code: GrpcStatus.FAILED_PRECONDITION,
        details: '예약 불가능한 날짜가 포함되어 있습니다.',
      }),
    ).toEqual({
      code: GrpcStatus.FAILED_PRECONDITION,
      message: '예약 불가능한 날짜가 포함되어 있습니다.',
    });
  });

  it('없는 객실(NOT_FOUND)이면 NOT_FOUND(→ 404)', async () => {
    expect(
      await failWith({
        code: GrpcStatus.NOT_FOUND,
        details: '존재하지 않는 객실입니다.',
      }),
    ).toEqual({
      code: GrpcStatus.NOT_FOUND,
      message: '존재하지 않는 객실입니다.',
    });
  });

  it.each([
    ['연결 실패', GrpcStatus.UNAVAILABLE],
    ['시간 초과', GrpcStatus.DEADLINE_EXCEEDED],
    ['알 수 없는 오류', GrpcStatus.UNKNOWN],
  ])('%s면 매진이 아니라 UNAVAILABLE(→ 503)', async (_, code) => {
    expect(await failWith({ code, details: 'boom' })).toMatchObject({
      code: GrpcStatus.UNAVAILABLE,
    });
  });
});
