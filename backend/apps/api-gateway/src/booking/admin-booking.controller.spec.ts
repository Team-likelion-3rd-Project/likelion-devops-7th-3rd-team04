import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AuthenticatedUser } from '@app/common';
import { AdminBookingController } from './admin-booking.controller';

// LDP-90: 관리자 예약 API — 회원 확인·직원 이름 조회·응답 변환
describe('AdminBookingController', () => {
  const booking = {
    getBookings: jest.fn(),
    createAdminBooking: jest.fn(),
    adminCancelBooking: jest.fn(),
    createExtensionBooking: jest.fn(),
  };
  const user = {
    getUserById: jest.fn(),
    getUsers: jest.fn(),
    getUsersByIds: jest.fn(),
  };
  const adminLookup = { getAdminById: jest.fn() };
  const hotel = { getHotels: jest.fn(), listRoomUnits: jest.fn() };
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
      { getService: () => hotel } as never,
    );
    controller.onModuleInit();
  });

  // LDP-136: 관리자 예약 목록 — 조건·페이지. 회원 검색은 user-service에서 회원을 찾아 넘긴다
  describe('getBookings', () => {
    beforeEach(() => {
      booking.getBookings.mockReturnValue(
        of({ bookings: [grpcBooking], total: 37 }),
      );
      user.getUsers.mockReturnValue(of({ users: [{ id: 7 }, { id: 9 }] }));
      user.getUsersByIds.mockReturnValue(of({ users: [] }));
      hotel.getHotels.mockReturnValue(
        of({ hotels: [{ hotelId: 1 }, { hotelId: 2 }] }),
      );
      hotel.listRoomUnits.mockImplementation(
        ({ hotelId }: { hotelId: number }) =>
          of({
            units:
              hotelId === 1
                ? [
                    { roomUnitId: 3, roomNumber: '201' },
                    { roomUnitId: 4, roomNumber: '1201' },
                  ]
                : [{ roomUnitId: 8, roomNumber: 'B101' }],
          }),
      );
    });

    it('조건이 없으면 페이지를 나누지 않고 전체를 요청한다 (예전과 같은 목록) — 응답에 total', async () => {
      const result = await controller.getBookings({});

      expect(booking.getBookings).toHaveBeenCalledWith({
        page: 0,
        size: 20,
        hotelId: 0,
        statuses: [],
        hasKeyword: false,
        keywordReservationId: 0,
        keywordUserIds: [],
        linkedTo: 0,
        keywordRoomUnitIds: [],
      });
      expect(user.getUsers).not.toHaveBeenCalled();
      expect(hotel.listRoomUnits).not.toHaveBeenCalled();
      expect(result.total).toBe(37);
      expect(result.bookings[0]).toMatchObject({
        reservationId: 12,
        roomUnitId: null,
      });
    });

    // LDP-150: 예약자 이름·이메일 — 회원 전체 조회 없이 화면에 보이게
    it('예약자 이름·이메일을 붙인다 — 이 응답의 회원을 한 번에(중복 없이) 조회', async () => {
      booking.getBookings.mockReturnValue(
        of({
          bookings: [
            { ...grpcBooking, reservationId: 1, userId: 7 },
            { ...grpcBooking, reservationId: 2, userId: 7 },
            { ...grpcBooking, reservationId: 3, userId: 9 },
          ],
          total: 3,
        }),
      );
      user.getUsersByIds.mockReturnValue(
        of({ users: [{ id: 7, name: '홍길동', email: 'hong@t.com' }] }),
      );

      const { bookings } = await controller.getBookings({});

      expect(user.getUsersByIds).toHaveBeenCalledTimes(1);
      expect(user.getUsersByIds).toHaveBeenCalledWith({ ids: [7, 9] });
      expect(bookings.map((b) => [b.guestName, b.guestEmail])).toEqual([
        ['홍길동', 'hong@t.com'],
        ['홍길동', 'hong@t.com'],
        ['', ''], // 회원 9는 없음(탈퇴 등)
      ]);
    });

    it('회원 조회가 실패해도 예약 목록은 보여 준다 (이름만 빈 값)', async () => {
      user.getUsersByIds.mockReturnValue(
        throwError(() => ({ code: 14, details: 'No connection established' })),
      );

      const result = await controller.getBookings({});

      expect(result.total).toBe(37);
      expect(result.bookings[0]).toMatchObject({
        reservationId: 12,
        guestName: '',
        guestEmail: '',
      });
    });

    it('예약이 없으면 회원을 조회하지 않는다', async () => {
      booking.getBookings.mockReturnValue(of({ bookings: [], total: 0 }));

      await controller.getBookings({});

      expect(user.getUsersByIds).not.toHaveBeenCalled();
    });

    it('page·지점·상태·연장 묶음 조건을 그대로 넘긴다', async () => {
      await controller.getBookings({
        page: 2,
        size: 50,
        hotelId: 1,
        status: ['PENDING_PAYMENT', 'RESERVED'],
        linkedTo: 12,
      });

      expect(booking.getBookings).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          size: 50,
          hotelId: 1,
          statuses: ['PENDING_PAYMENT', 'RESERVED'],
          linkedTo: 12,
        }),
      );
    });

    it('검색어는 회원 이름·이메일·연락처로 찾은 회원의 예약 — 회원은 user-service에서 찾는다', async () => {
      await controller.getBookings({ keyword: ' 홍길동 ' });

      expect(user.getUsers).toHaveBeenCalledWith({
        page: 1,
        size: 500,
        keyword: '홍길동',
      });
      expect(booking.getBookings).toHaveBeenCalledWith(
        expect.objectContaining({
          hasKeyword: true,
          keywordReservationId: 0,
          keywordUserIds: [7, 9],
        }),
      );
    });

    it('숫자 검색어는 예약번호로도 찾는다', async () => {
      await controller.getBookings({ keyword: '12' });

      expect(booking.getBookings).toHaveBeenCalledWith(
        expect.objectContaining({
          hasKeyword: true,
          keywordReservationId: 12,
          keywordUserIds: [7, 9],
        }),
      );
    });

    it('방 번호로도 찾는다 — 지점 조건이 없으면 모든 지점의 호실에서 (대소문자 무시)', async () => {
      await controller.getBookings({ keyword: '201' });

      expect(hotel.listRoomUnits).toHaveBeenCalledTimes(2);
      expect(booking.getBookings).toHaveBeenCalledWith(
        expect.objectContaining({ keywordRoomUnitIds: [3, 4] }),
      );

      await controller.getBookings({ keyword: 'b1' });
      expect(booking.getBookings).toHaveBeenLastCalledWith(
        expect.objectContaining({ keywordRoomUnitIds: [8] }),
      );
    });

    it('지점 조건이 있으면 그 지점 호실만 본다', async () => {
      await controller.getBookings({ keyword: '201', hotelId: 1 });

      expect(hotel.getHotels).not.toHaveBeenCalled();
      expect(hotel.listRoomUnits).toHaveBeenCalledWith({
        hotelId: 1,
        roomId: 0,
        status: '',
      });
    });

    it('호실 조회가 실패하면 503 HOTEL_SERVICE_UNAVAILABLE', async () => {
      hotel.getHotels.mockReturnValue(
        throwError(() => ({ code: 14, details: 'No connection established' })),
      );

      const { status, body } = await httpError(
        controller.getBookings({ keyword: '201' }),
      );

      expect(status).toBe(503);
      expect(body).toMatchObject({ code: 'HOTEL_SERVICE_UNAVAILABLE' });
    });

    it('회원 검색이 실패하면 503 USER_SERVICE_UNAVAILABLE', async () => {
      user.getUsers.mockReturnValue(
        throwError(() => ({ code: 14, details: 'No connection established' })),
      );

      const { status, body } = await httpError(
        controller.getBookings({ keyword: '홍' }),
      );

      expect(status).toBe(503);
      expect(body).toMatchObject({ code: 'USER_SERVICE_UNAVAILABLE' });
      expect(booking.getBookings).not.toHaveBeenCalled();
    });
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
