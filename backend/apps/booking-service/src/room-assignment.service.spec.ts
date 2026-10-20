import { of, throwError } from 'rxjs';
import { DataSource, Repository } from 'typeorm';
import { parseApiRpcError } from '@app/common';
import { RoomAssignmentService } from './room-assignment.service';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';

// LDP-89: 예약 호실 배정
describe('RoomAssignmentService', () => {
  const reservation = (overrides: Partial<Reservation> = {}) =>
    ({
      reservationId: 1,
      userId: 7,
      roomId: 1,
      hotelId: 1,
      checkInDate: '2026-11-01',
      checkOutDate: '2026-11-03',
      status: ReservationStatus.RESERVED,
      roomUnitId: null,
      ...overrides,
    }) as Reservation;
  const unit = (overrides = {}) => ({
    roomUnitId: 10,
    roomId: 1,
    roomName: '디럭스 더블룸',
    hotelId: 1,
    roomNumber: '201',
    floor: 2,
    status: 'ACTIVE',
    ...overrides,
  });

  const findOne = jest.fn();
  const update = jest.fn();
  const getRoomUnitsByIds = jest.fn();
  const getBookingById = jest.fn();
  // GET_LOCK 결과, 겹치는 배정 조회 결과
  let lockResult: number | null;
  let conflict: Partial<Reservation> | null;
  const query = jest.fn();
  const release = jest.fn();
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(() => Promise.resolve(conflict)),
  };
  let service: RoomAssignmentService;

  const codeOf = (error: unknown) => parseApiRpcError(error)?.code;
  const assign = (roomUnitId = 10) =>
    service.assign(1, roomUnitId).catch((e: unknown) => e);

  beforeEach(() => {
    jest.clearAllMocks();
    lockResult = 1;
    conflict = null;
    findOne.mockResolvedValue(reservation());
    update.mockResolvedValue({ affected: 1 });
    getRoomUnitsByIds.mockReturnValue(of({ units: [unit()] }));
    getBookingById.mockResolvedValue({ reservationId: 1, roomUnitId: 10 });
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('GET_LOCK') ? [{ ok: lockResult }] : []),
    );
    const manager = {
      update,
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    service = new RoomAssignmentService(
      { findOne, manager } as unknown as Repository<Reservation>,
      {
        createQueryRunner: () => ({
          connect: jest.fn(),
          query,
          release,
          manager,
        }),
      } as unknown as DataSource,
      { getBookingById } as unknown as BookingServiceService,
      { getService: () => ({ getRoomUnitsByIds }) } as never,
    );
    service.onModuleInit();
  });

  it('같은 객실 종류의 ACTIVE 호실을 배정하고 잠금을 풀어 준다', async () => {
    const result = await assign();

    expect(result).toEqual({ reservationId: 1, roomUnitId: 10 });
    expect(query).toHaveBeenCalledWith('SELECT GET_LOCK(?, ?) AS ok', [
      'room_unit:10',
      5,
    ]);
    expect(update).toHaveBeenCalledWith(
      Reservation,
      expect.objectContaining({ reservationId: 1 }),
      { roomUnitId: 10 },
    );
    expect(query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', [
      'room_unit:10',
    ]);
    expect(release).toHaveBeenCalled();
  });

  it('roomUnitId 0이면 배정을 해제한다 (호실 조회·잠금 없이)', async () => {
    findOne.mockResolvedValue(reservation({ roomUnitId: 10 }));

    await assign(0);

    expect(update).toHaveBeenCalledWith(
      Reservation,
      expect.objectContaining({ reservationId: 1 }),
      { roomUnitId: null },
    );
    expect(getRoomUnitsByIds).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('예약이 없으면 404 RESERVATION_NOT_FOUND', async () => {
    findOne.mockResolvedValue(null);
    expect(codeOf(await assign())).toBe('RESERVATION_NOT_FOUND');
  });

  it.each([
    ReservationStatus.CANCELLED,
    ReservationStatus.EXPIRED,
    ReservationStatus.PAYMENT_FAILED,
  ])('%s 예약이면 409 INVALID_RESERVATION_STATUS', async (status) => {
    findOne.mockResolvedValue(reservation({ status }));
    expect(codeOf(await assign())).toBe('INVALID_RESERVATION_STATUS');
    expect(update).not.toHaveBeenCalled();
  });

  it('호실이 없으면 404 ROOM_UNIT_NOT_FOUND', async () => {
    getRoomUnitsByIds.mockReturnValue(of({ units: [] }));
    expect(codeOf(await assign())).toBe('ROOM_UNIT_NOT_FOUND');
  });

  it.each([
    ['다른 객실 종류', { roomId: 2 }],
    ['다른 지점', { hotelId: 2 }],
    ['점검 중', { status: 'OUT_OF_SERVICE' }],
  ])('%s 호실이면 409 ROOM_UNIT_NOT_ASSIGNABLE', async (_label, overrides) => {
    getRoomUnitsByIds.mockReturnValue(of({ units: [unit(overrides)] }));
    expect(codeOf(await assign())).toBe('ROOM_UNIT_NOT_ASSIGNABLE');
    expect(update).not.toHaveBeenCalled();
  });

  it('같은 호실·겹치는 기간에 다른 배정이 있으면 409 ROOM_UNIT_ASSIGNMENT_CONFLICT (잠금은 풀린다)', async () => {
    conflict = {
      reservationId: 2,
      checkInDate: '2026-11-02',
      checkOutDate: '2026-11-04',
    };

    expect(codeOf(await assign())).toBe('ROOM_UNIT_ASSIGNMENT_CONFLICT');
    expect(update).not.toHaveBeenCalled();
    // 겹침 조건: 상대 체크인 < 내 체크아웃 && 상대 체크아웃 > 내 체크인
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'r.checkInDate < :checkOut',
      { checkOut: '2026-11-03' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'r.checkOutDate > :checkIn',
      { checkIn: '2026-11-01' },
    );
    expect(query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', [
      'room_unit:10',
    ]);
    expect(release).toHaveBeenCalled();
  });

  it('다른 직원이 같은 호실을 배정하는 중이라 잠금을 못 잡으면 409 ROOM_UNIT_BUSY (재시도 가능)', async () => {
    lockResult = 0;

    const error = await assign();

    expect(parseApiRpcError(error)).toMatchObject({
      code: 'ROOM_UNIT_BUSY',
      retryable: true,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('확인 뒤 저장 직전에 예약이 취소됐으면 409 INVALID_RESERVATION_STATUS', async () => {
    update.mockResolvedValue({ affected: 0 });
    expect(codeOf(await assign())).toBe('INVALID_RESERVATION_STATUS');
  });

  it('hotel-service에 연결할 수 없으면 503 HOTEL_SERVICE_UNAVAILABLE', async () => {
    getRoomUnitsByIds.mockReturnValue(
      throwError(() => new Error('14 UNAVAILABLE')),
    );
    expect(parseApiRpcError(await assign())).toMatchObject({
      status: 503,
      code: 'HOTEL_SERVICE_UNAVAILABLE',
    });
  });
});
