import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { AuthenticatedUser } from '@app/common';
import { BookingController } from './booking.controller';
import { CreateBookingDto } from './dto/create-booking.dto';

describe('BookingController', () => {
  const createBooking = jest.fn();
  const getBookingsByUserId = jest.fn();
  let controller: BookingController;

  const user = { userId: 10 } as AuthenticatedUser;
  const dto = {
    roomId: 1,
    hotelId: 1,
    checkInDate: '2026-09-01',
    checkOutDate: '2026-09-03',
    guestCount: 2,
  } as CreateBookingDto;

  // 실패 응답의 HTTP 상태와 본문
  const responseOf = async (promise: Promise<unknown>) => {
    const err = (await promise.catch((e: unknown) => e)) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    return { status: err.getStatus(), body: err.getResponse() };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new BookingController({
      getService: () => ({ createBooking, getBookingsByUserId }),
    } as never);
    controller.onModuleInit();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // LDP-198: 예전에는 모든 실패가 404라 매진·없는 객실·서비스 장애가 구분되지 않았다
  describe('createBooking 실패', () => {
    it('매진이면 409 ROOM_NOT_AVAILABLE', async () => {
      createBooking.mockReturnValue(
        throwError(() => ({
          code: GrpcStatus.FAILED_PRECONDITION,
          details: '예약 불가능한 날짜가 포함되어 있습니다.',
        })),
      );

      expect(
        await responseOf(controller.createBooking(user, dto)),
      ).toMatchObject({
        status: 409,
        body: {
          code: 'ROOM_NOT_AVAILABLE',
          message: '예약 불가능한 날짜가 포함되어 있습니다.',
        },
      });
    });

    it('없는 객실이면 404 ROOM_NOT_FOUND', async () => {
      createBooking.mockReturnValue(
        throwError(() => ({
          code: GrpcStatus.NOT_FOUND,
          details: '존재하지 않는 객실입니다.',
        })),
      );

      expect(
        await responseOf(controller.createBooking(user, dto)),
      ).toMatchObject({
        status: 404,
        body: { code: 'ROOM_NOT_FOUND' },
      });
    });

    it.each([
      ['연결 실패', GrpcStatus.UNAVAILABLE],
      ['시간 초과', GrpcStatus.DEADLINE_EXCEEDED],
    ])('%s면 503 BOOKING_SERVICE_UNAVAILABLE', async (_, code) => {
      createBooking.mockReturnValue(throwError(() => ({ code })));

      expect(
        await responseOf(controller.createBooking(user, dto)),
      ).toMatchObject({
        status: 503,
        body: {
          code: 'BOOKING_SERVICE_UNAVAILABLE',
          retryable: true,
        },
      });
    });
  });

  describe('getMyBookings', () => {
    it('본인 예약 목록을 돌려준다', async () => {
      getBookingsByUserId.mockReturnValue(of({ bookings: [] }));

      expect(await controller.getMyBookings(user)).toEqual({ bookings: [] });
      expect(getBookingsByUserId).toHaveBeenCalledWith({ userId: 10 });
    });

    it('booking-service 장애면 503 (예전에는 500)', async () => {
      getBookingsByUserId.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.UNAVAILABLE })),
      );

      expect((await responseOf(controller.getMyBookings(user))).status).toBe(
        503,
      );
    });
  });
});
