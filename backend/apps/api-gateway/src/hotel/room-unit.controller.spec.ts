import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { apiRpcException } from '@app/common';
import { RoomUnitController } from './room-unit.controller';

// LDP-89: 호실 관리 API — hotel·booking·user 서비스를 함께 쓰는 확인·조합
describe('RoomUnitController', () => {
  const unit = (overrides = {}) => ({
    roomUnitId: 1,
    roomId: 1,
    roomName: '디럭스 더블룸',
    hotelId: 1,
    roomNumber: '201',
    floor: 2,
    status: 'ACTIVE',
    ...overrides,
  });

  const hotel = {
    listRoomUnits: jest.fn(),
    getRoomUnitsByIds: jest.fn(),
    createRoomUnit: jest.fn(),
    updateRoomUnit: jest.fn(),
    setRoomUnitStatus: jest.fn(),
  };
  const booking = {
    listUnitAssignments: jest.fn(),
    countFutureUnitAssignments: jest.fn(),
  };
  const user = { getUserById: jest.fn() };
  let controller: RoomUnitController;

  const client = (service: object) => ({ getService: () => service }) as never;
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
    hotel.getRoomUnitsByIds.mockReturnValue(of({ units: [unit()] }));
    hotel.setRoomUnitStatus.mockReturnValue(
      of(unit({ status: 'OUT_OF_SERVICE' })),
    );
    booking.countFutureUnitAssignments.mockReturnValue(of({ count: 0 }));
    controller = new RoomUnitController(
      client(hotel),
      client(booking),
      client(user),
    );
    controller.onModuleInit();
  });

  describe('PUT /:hotelId/units/:roomUnitId/status', () => {
    it('점검하려는 호실에 미래 배정이 있으면 409 ROOM_UNIT_HAS_ASSIGNMENTS (상태는 안 바뀜)', async () => {
      booking.countFutureUnitAssignments.mockReturnValue(of({ count: 2 }));

      const { status, body } = await httpError(
        controller.setUnitStatus(1, 1, { status: 'OUT_OF_SERVICE' }),
      );

      expect(status).toBe(409);
      expect(body).toMatchObject({
        statusCode: 409,
        code: 'ROOM_UNIT_HAS_ASSIGNMENTS',
        retryable: false,
      });
      expect(hotel.setRoomUnitStatus).not.toHaveBeenCalled();
    });

    it('미래 배정이 없으면 점검 처리한다', async () => {
      const result = await controller.setUnitStatus(1, 1, {
        status: 'OUT_OF_SERVICE',
      });

      expect(result.status).toBe('OUT_OF_SERVICE');
      expect(booking.countFutureUnitAssignments).toHaveBeenCalledWith({
        roomUnitId: 1,
      });
    });

    it('다른 지점 호실이면 배정 확인 전에 404 ROOM_UNIT_NOT_FOUND', async () => {
      hotel.getRoomUnitsByIds.mockReturnValue(
        of({ units: [unit({ hotelId: 2 })] }),
      );

      const { status, body } = await httpError(
        controller.setUnitStatus(1, 1, { status: 'OUT_OF_SERVICE' }),
      );

      expect(status).toBe(404);
      expect(body.code).toBe('ROOM_UNIT_NOT_FOUND');
      expect(booking.countFutureUnitAssignments).not.toHaveBeenCalled();
    });

    it('점검 해제는 배정 확인 없이 바로 처리한다', async () => {
      hotel.setRoomUnitStatus.mockReturnValue(of(unit()));

      await controller.setUnitStatus(1, 1, { status: 'ACTIVE' });

      expect(booking.countFutureUnitAssignments).not.toHaveBeenCalled();
    });

    it('hotel-service의 api-error(오버부킹)는 그대로 전달한다', async () => {
      hotel.setRoomUnitStatus.mockReturnValue(
        throwError(() =>
          apiRpcException({
            status: 409,
            code: 'ROOM_UNIT_OVERBOOKING',
            message: '...',
            retryable: false,
          }),
        ),
      );

      const { status, body } = await httpError(
        controller.setUnitStatus(1, 1, { status: 'OUT_OF_SERVICE' }),
      );

      expect(status).toBe(409);
      expect(body.code).toBe('ROOM_UNIT_OVERBOOKING');
    });
  });

  describe('GET /:hotelId/unit-assignments', () => {
    beforeEach(() => {
      hotel.listRoomUnits.mockReturnValue(
        of({
          units: [unit(), unit({ roomUnitId: 2, roomNumber: '202', floor: 0 })],
        }),
      );
      booking.listUnitAssignments.mockReturnValue(
        of({
          assignments: [
            {
              reservationId: 12,
              roomId: 1,
              roomUnitId: 1,
              checkInDate: '2026-11-01',
              checkOutDate: '2026-11-03',
              status: 'RESERVED',
              userId: 7,
            },
            {
              reservationId: 15,
              roomId: 1,
              roomUnitId: 0,
              checkInDate: '2026-11-02',
              checkOutDate: '2026-11-04',
              status: 'PENDING_PAYMENT',
              userId: 9,
            },
          ],
        }),
      );
      user.getUserById.mockImplementation(({ id }: { id: number }) =>
        id === 7
          ? of({ id: 7, name: '홍길동' })
          : throwError(() => new Error('not found')),
      );
    });

    it('호실별 배정과 미배정 예약을 나누고, 예약자 이름을 붙인다', async () => {
      const result = await controller.getUnitAssignments(1, {
        startDate: '2026-11-01',
        endDate: '2026-11-07',
      });

      expect(result.units).toHaveLength(2);
      expect(result.units[0].assignments).toEqual([
        {
          reservationId: 12,
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-03',
          reservationStatus: 'RESERVED',
          userId: 7,
          guestName: '홍길동',
        },
      ]);
      expect(result.units[1]).toMatchObject({ floor: null, assignments: [] });
      // 회원 조회가 실패해도 목록은 보이고 이름만 빈 문자열
      expect(result.unassigned).toEqual([
        expect.objectContaining({
          reservationId: 15,
          roomId: 1,
          guestName: '',
        }),
      ]);
    });

    it('기간이 31일을 넘으면 400', async () => {
      const { status, body } = await httpError(
        controller.getUnitAssignments(1, {
          startDate: '2026-11-01',
          endDate: '2026-12-02',
        }),
      );

      expect(status).toBe(400);
      expect(body.code).toBe('INVALID_DATE_RANGE');
      expect(booking.listUnitAssignments).not.toHaveBeenCalled();
    });

    it('31일까지는 허용한다', async () => {
      await controller.getUnitAssignments(1, {
        startDate: '2026-11-01',
        endDate: '2026-12-01',
      });

      expect(booking.listUnitAssignments).toHaveBeenCalled();
    });

    it('종료일이 시작일보다 빠르면 400', async () => {
      const { status } = await httpError(
        controller.getUnitAssignments(1, {
          startDate: '2026-11-07',
          endDate: '2026-11-01',
        }),
      );

      expect(status).toBe(400);
    });
  });
});
