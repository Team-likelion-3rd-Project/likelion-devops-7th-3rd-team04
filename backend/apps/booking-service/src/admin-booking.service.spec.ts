import { Repository } from 'typeorm';
import { apiRpcException, parseApiRpcError } from '@app/common';
import { AdminBookingService } from './admin-booking.service';
import { BookingServiceService } from './booking-service.service';
import { RoomAssignmentService } from './room-assignment.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';

// LDP-90: 관리자 대리 예약·직원 취소·투숙 연장
describe('AdminBookingService', () => {
  const reservation = (overrides: Partial<Reservation> = {}) =>
    ({
      reservationId: 12,
      userId: 7,
      roomId: 1,
      hotelId: 1,
      checkInDate: '2026-11-01',
      checkOutDate: '2026-11-03',
      guestCount: 2,
      status: ReservationStatus.RESERVED,
      roomUnitId: 5,
      linkedReservationId: null,
      ...overrides,
    }) as Reservation;

  const findOne = jest.fn();
  const createBooking = jest.fn();
  const cancelReservation = jest.fn();
  const cancelLinkedExtensions = jest.fn();
  const getBookingById = jest.fn();
  const assign = jest.fn();
  let service: AdminBookingService;

  const codeOf = (error: unknown) => parseApiRpcError(error)?.code;
  const admin = { adminId: 3, adminName: '김직원' };

  beforeEach(() => {
    jest.clearAllMocks();
    findOne.mockResolvedValue(reservation());
    createBooking.mockResolvedValue({ reservationId: 20 });
    cancelReservation.mockResolvedValue(true);
    getBookingById.mockImplementation((id: number) =>
      Promise.resolve({ reservationId: id }),
    );
    assign.mockImplementation((id: number, unitId: number) =>
      Promise.resolve({ reservationId: id, roomUnitId: unitId }),
    );
    service = new AdminBookingService(
      { findOne } as unknown as Repository<Reservation>,
      {
        createBooking,
        cancelReservation,
        cancelLinkedExtensions,
        getBookingById,
      } as unknown as BookingServiceService,
      { assign } as unknown as RoomAssignmentService,
    );
  });

  describe('createProxyBooking (대리 예약)', () => {
    it('회원 명의로 예약하고 만든 직원·결제 마감을 함께 넘긴다', async () => {
      await service.createProxyBooking({
        userId: 7,
        roomId: 1,
        hotelId: 1,
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-03',
        guestCount: 2,
        ...admin,
      });

      expect(createBooking).toHaveBeenCalledWith(
        expect.not.objectContaining({ adminId: 3 }),
        {
          createdByAdminId: 3,
          createdByAdminName: '김직원',
        },
      );
      expect(createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7 }),
        expect.anything(),
      );
    });
  });

  describe('cancel (직원 취소)', () => {
    const cancel = (cancelReason = '손님 전화 요청', reservationId = 12) =>
      service
        .cancel({ reservationId, adminId: 3, cancelReason })
        .catch((e: unknown) => e);

    it('취소 직원·사유를 기록하고, 원래 예약이면 연장 예약도 같은 사유로 취소한다', async () => {
      await cancel();

      const record = { cancelledByAdminId: 3, cancelReason: '손님 전화 요청' };
      expect(cancelReservation).toHaveBeenCalledWith(
        expect.objectContaining({ reservationId: 12 }),
        record,
      );
      expect(cancelLinkedExtensions).toHaveBeenCalledWith(12, record);
      expect(getBookingById).toHaveBeenCalledWith(12);
    });

    it('연장 예약만 취소하면 원래 예약·다른 연장은 건드리지 않는다', async () => {
      findOne.mockResolvedValue(
        reservation({ reservationId: 20, linkedReservationId: 12 }),
      );

      await cancel('연장 취소', 20);

      expect(cancelReservation).toHaveBeenCalledTimes(1);
      expect(cancelLinkedExtensions).not.toHaveBeenCalled();
    });

    it('사유가 비어 있으면 400 INVALID_CANCEL_REASON', async () => {
      expect(codeOf(await cancel('   '))).toBe('INVALID_CANCEL_REASON');
      expect(cancelReservation).not.toHaveBeenCalled();
    });

    it('예약이 없으면 404 RESERVATION_NOT_FOUND', async () => {
      findOne.mockResolvedValue(null);
      expect(codeOf(await cancel())).toBe('RESERVATION_NOT_FOUND');
    });

    it('이미 취소·만료·완료된 예약이면 409 INVALID_RESERVATION_STATUS', async () => {
      cancelReservation.mockResolvedValue(false);
      expect(codeOf(await cancel())).toBe('INVALID_RESERVATION_STATUS');
      expect(cancelLinkedExtensions).not.toHaveBeenCalled();
    });
  });

  describe('createExtension (투숙 연장)', () => {
    const extend = (overrides = {}) =>
      service
        .createExtension({
          reservationId: 12,
          checkOutDate: '2026-11-05',
          keepSameRoomUnit: true,
          ...admin,
          ...overrides,
        })
        .catch((e: unknown) => e);

    it('체크아웃부터 같은 회원·객실 종류·인원으로 이어 붙이고 원래 예약에 연결한다', async () => {
      await extend();

      expect(createBooking).toHaveBeenCalledWith(
        {
          userId: 7,
          roomId: 1,
          hotelId: 1,
          checkInDate: '2026-11-03',
          checkOutDate: '2026-11-05',
          guestCount: 2,
        },
        expect.objectContaining({
          createdByAdminId: 3,
          linkedReservationId: 12,
        }),
      );
    });

    it('연장의 연장은 맨 처음 원래 예약에 연결한다', async () => {
      findOne.mockResolvedValue(
        reservation({
          reservationId: 20,
          linkedReservationId: 12,
          checkInDate: '2026-11-03',
          checkOutDate: '2026-11-05',
        }),
      );

      await extend({ reservationId: 20, checkOutDate: '2026-11-06' });

      expect(createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ checkInDate: '2026-11-05' }),
        expect.objectContaining({ linkedReservationId: 12 }),
      );
    });

    it('같은 호실이 비어 있으면 같은 호실로 배정한다', async () => {
      const result = await extend();

      expect(assign).toHaveBeenCalledWith(20, 5);
      expect(result).toEqual({ reservationId: 20, roomUnitId: 5 });
    });

    it('같은 호실이 그 기간에 막혀 있으면 미배정으로 두고 연장 예약은 만든다', async () => {
      assign.mockRejectedValue(
        apiRpcException({
          status: 409,
          code: 'ROOM_UNIT_ASSIGNMENT_CONFLICT',
          message: '...',
          retryable: false,
        }),
      );

      const result = await extend();

      expect(result).toEqual({ reservationId: 20 });
      expect(getBookingById).toHaveBeenCalledWith(20);
    });

    it('keepSameRoomUnit=false거나 원래 예약이 미배정이면 배정하지 않는다', async () => {
      await extend({ keepSameRoomUnit: false });
      findOne.mockResolvedValue(reservation({ roomUnitId: null }));
      await extend();

      expect(assign).not.toHaveBeenCalled();
    });

    it('예약 확정이 아니면 409 INVALID_RESERVATION_STATUS', async () => {
      findOne.mockResolvedValue(
        reservation({ status: ReservationStatus.PENDING_PAYMENT }),
      );
      expect(codeOf(await extend())).toBe('INVALID_RESERVATION_STATUS');
      expect(createBooking).not.toHaveBeenCalled();
    });

    it('새 체크아웃이 기존 체크아웃과 같거나 빠르면 400 INVALID_EXTENSION_DATES', async () => {
      expect(codeOf(await extend({ checkOutDate: '2026-11-03' }))).toBe(
        'INVALID_EXTENSION_DATES',
      );
      expect(createBooking).not.toHaveBeenCalled();
    });
  });
});
