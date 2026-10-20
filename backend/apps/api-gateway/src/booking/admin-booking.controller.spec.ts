import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AuthenticatedUser } from '@app/common';
import { AdminBookingController } from './admin-booking.controller';

// LDP-90: 관리자 예약 API — 회원 확인·직원 이름 조회·응답 변환
describe('AdminBookingController', () => {
  const booking = {
    createAdminBooking: jest.fn(),
    adminCancelBooking: jest.fn(),
    createExtensionBooking: jest.fn(),
  };
  const user = { getUserById: jest.fn() };
  const adminLookup = { getAdminById: jest.fn() };
  const admin = {
    userId: 3,
    email: 'staff@hotel.com',
    role: 'ADMIN',
    type: 'ADMIN',
  } as AuthenticatedUser;
  const dto = {
    userId: 7,
    roomId: 1,
    hotelId: 1,
    checkInDate: '2026-11-01',
    checkOutDate: '2026-11-03',
    guestCount: 2,
  };
  // gRPC는 "없음"을 0·빈 문자열로 보낸다
  const grpcBooking = {
    reservationId: 12,
    roomUnitId: 0,
    roomNumber: '',
    linkedReservationId: 0,
    createdByAdminId: 3,
    createdByAdminName: '김직원',
    cancelledByAdminId: 0,
    cancelReason: '',
    createdAt: '2026-10-20T01:00:00.000Z',
  };
  let controller: AdminBookingController;

  const httpError = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    return {
      status: (error as HttpException).getStatus(),
      body: (error as HttpException).getResponse() as Record<string, unknown>,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    user.getUserById.mockReturnValue(of({ id: 7, name: '홍길동' }));
    adminLookup.getAdminById.mockReturnValue(of({ id: 3, name: '김직원' }));
    booking.createAdminBooking.mockReturnValue(of(grpcBooking));
    controller = new AdminBookingController(
      { getService: () => booking } as never,
      // user.proto에는 UserService(회원)와 AdminService(직원)가 따로 있다
      {
        getService: (name: string) =>
          name === 'AdminService' ? adminLookup : user,
      } as never,
    );
    controller.onModuleInit();
  });

  it('회원을 확인하고 직원 이름과 함께 대리 예약을 만든다 (0은 null로 바꿔 응답)', async () => {
    const result = await controller.createAdminBooking(admin, dto);

    expect(booking.createAdminBooking).toHaveBeenCalledWith({
      ...dto,
      adminId: 3,
      adminName: '김직원',
    });
    expect(result).toMatchObject({
      roomUnitId: null,
      linkedReservationId: null,
      createdByAdminId: 3,
      createdByAdminName: '김직원',
      cancelledByAdminId: null,
      cancelReason: '',
    });
  });

  it('없는 회원이면 404 USER_NOT_FOUND (예약하지 않음)', async () => {
    user.getUserById.mockReturnValue(
      throwError(() => ({ code: 2, details: '존재하지 않는 유저입니다.' })),
    );

    const { status, body } = await httpError(
      controller.createAdminBooking(admin, dto),
    );

    expect(status).toBe(404);
    expect(body.code).toBe('USER_NOT_FOUND');
    expect(booking.createAdminBooking).not.toHaveBeenCalled();
  });

  it('user-service에 연결할 수 없으면 503 USER_SERVICE_UNAVAILABLE', async () => {
    user.getUserById.mockReturnValue(
      throwError(() => ({ code: 14, details: 'No connection established' })),
    );

    const { status, body } = await httpError(
      controller.createAdminBooking(admin, dto),
    );

    expect(status).toBe(503);
    expect(body).toMatchObject({
      code: 'USER_SERVICE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('직원 이름 조회가 실패해도 이메일로 대신하고 예약은 만든다', async () => {
    adminLookup.getAdminById.mockReturnValue(
      throwError(() => new Error('down')),
    );

    await controller.createAdminBooking(admin, dto);

    expect(booking.createAdminBooking).toHaveBeenCalledWith(
      expect.objectContaining({ adminName: 'staff@hotel.com' }),
    );
  });

  it('연장은 keepSameRoomUnit을 생략하면 true로 보낸다', async () => {
    booking.createExtensionBooking.mockReturnValue(of(grpcBooking));

    await controller.createExtensionBooking(admin, 12, {
      checkOutDate: '2026-11-05',
    });

    expect(booking.createExtensionBooking).toHaveBeenCalledWith({
      reservationId: 12,
      checkOutDate: '2026-11-05',
      keepSameRoomUnit: true,
      adminId: 3,
      adminName: '김직원',
    });
  });

  it('직원 취소는 사유 앞뒤 공백을 지워 보낸다', async () => {
    booking.adminCancelBooking.mockReturnValue(of(grpcBooking));

    await controller.adminCancelBooking(admin, 12, {
      cancelReason: '  노쇼  ',
    });

    expect(booking.adminCancelBooking).toHaveBeenCalledWith({
      reservationId: 12,
      adminId: 3,
      cancelReason: '노쇼',
    });
  });
});
