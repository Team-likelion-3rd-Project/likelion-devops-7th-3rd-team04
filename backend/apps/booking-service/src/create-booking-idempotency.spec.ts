import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { of } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// LDP-240: 예약 생성 멱등 키. 503을 받고 다시 누르면 같은 키가 오고, 같은 예약을 돌려줘야 한다.
describe('createBooking — 멱등 키', () => {
  const reserveRoomAvailability = jest.fn();
  const releaseRoomAvailability = jest.fn();
  const getFacilities = jest.fn();
  const findOne = jest.fn();
  const save = jest.fn();
  let service: BookingServiceService;

  const KEY = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
  const request = {
    userId: 10,
    roomId: 2,
    hotelId: 1,
    checkInDate: '2026-12-01',
    checkOutDate: '2026-12-03',
    guestCount: 2,
  };

  const existing = {
    reservationId: 36,
    userId: 10,
    roomId: 2,
    hotelId: 1,
    checkInDate: '2026-12-01',
    checkOutDate: '2026-12-03',
    guestCount: 2,
    totalAmount: 200000,
    status: ReservationStatus.PENDING_PAYMENT,
    idempotencyKey: KEY,
    createdAt: new Date('2026-11-06T03:00:00Z'),
  } as Reservation;

  const duplicateKeyError = () =>
    new QueryFailedError('INSERT', [], {
      code: 'ER_DUP_ENTRY',
    } as unknown as Error);

  const errorOf = async (promise: Promise<unknown>) => {
    const thrown = await promise.catch((e: unknown) => e);
    return thrown instanceof RpcException ? thrown.getError() : thrown;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reserveRoomAvailability.mockReturnValue(of({ totalAmount: 200000 }));
    releaseRoomAvailability.mockReturnValue(of({ success: true }));
    getFacilities.mockReturnValue(of({ facilities: [] }));
    findOne.mockResolvedValue(null);
    save.mockImplementation((r: Reservation) =>
      Promise.resolve({ ...r, reservationId: 37, createdAt: new Date() }),
    );

    service = new BookingServiceService(
      {
        create: (r: Partial<Reservation>) => ({ ...r }),
        findOne,
        save,
      } as unknown as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      {} as DataSource,
      {
        createReservationFacility: jest.fn(),
      } as unknown as ReservationFacilityService,
      {
        getService: () => ({
          reserveRoomAvailability,
          releaseRoomAvailability,
          getFacilities,
        }),
      } as never,
      { getService: () => ({}) } as never,
    );
    service.onModuleInit();
  });

  it('처음 온 키면 새로 만들고 키를 함께 저장한다', async () => {
    const result = await service.createBooking({
      ...request,
      idempotencyKey: KEY,
    });

    expect(findOne).toHaveBeenCalledWith({
      where: { userId: 10, idempotencyKey: KEY },
    });
    expect(reserveRoomAvailability).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: KEY }),
    );
    expect(result.reservationId).toBe(37);
  });

  it('같은 회원·같은 키의 예약이 있으면 재고를 건드리지 않고 그 예약을 돌려준다', async () => {
    findOne.mockResolvedValue(existing);

    const result = await service.createBooking({
      ...request,
      idempotencyKey: KEY,
    });

    expect(result).toMatchObject({
      reservationId: 36,
      status: 'PENDING_PAYMENT',
    });
    expect(reserveRoomAvailability).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('같은 키로 객실·날짜가 다른 요청이 오면 409 IDEMPOTENCY_KEY_REUSED', async () => {
    findOne.mockResolvedValue(existing);

    const error = await errorOf(
      service.createBooking({
        ...request,
        checkOutDate: '2026-12-04',
        idempotencyKey: KEY,
      }),
    );

    expect(JSON.stringify(error)).toContain('IDEMPOTENCY_KEY_REUSED');
    expect(reserveRoomAvailability).not.toHaveBeenCalled();
  });

  it('거의 동시에 온 같은 키 요청: 저장이 UNIQUE에 막히면 재고를 돌려놓고 먼저 저장된 예약을 돌려준다', async () => {
    // 처음 조회 때는 아직 없음 → 재고 차감 → 저장 시 먼저 온 요청이 이미 저장해 충돌
    findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    save.mockRejectedValue(duplicateKeyError());

    const result = await service.createBooking({
      ...request,
      idempotencyKey: KEY,
    });

    expect(result.reservationId).toBe(36);
    expect(reserveRoomAvailability).toHaveBeenCalledTimes(1);
    expect(releaseRoomAvailability).toHaveBeenCalledTimes(1);
    expect(releaseRoomAvailability).toHaveBeenCalledWith({
      roomId: 2,
      startDate: '2026-12-01',
      endDate: '2026-12-02',
    });
  });

  it('키 없이 저장이 UNIQUE에 막히는 일은 없지만, 키가 없으면 다른 저장 오류처럼 재고만 돌려놓고 던진다', async () => {
    const dbError = duplicateKeyError();
    save.mockRejectedValue(dbError);

    expect(await errorOf(service.createBooking(request))).toBe(dbError);
    expect(releaseRoomAvailability).toHaveBeenCalledTimes(1);
  });

  it('키가 없으면 조회 없이 예전처럼 새로 만든다', async () => {
    await service.createBooking(request);

    expect(findOne).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: null }),
    );
  });

  // LDP-243: 관리자 대리 예약도 폼이 키를 보낸다. 키는 예약 대상 회원(userId) 기준
  it('관리자 대리 예약도 키가 오면 대상 회원 기준으로 조회하고 키를 함께 저장한다', async () => {
    await service.createBooking(
      { ...request, idempotencyKey: KEY },
      { createdByAdminId: 1, createdByAdminName: '직원' },
    );

    expect(findOne).toHaveBeenCalledWith({
      where: { userId: 10, idempotencyKey: KEY },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: KEY, createdByAdminId: 1 }),
    );
  });

  it('관리자 대리 예약을 같은 키로 다시 보내면 재고를 건드리지 않고 처음 만든 예약을 돌려준다', async () => {
    findOne.mockResolvedValue({ ...existing, createdByAdminId: 1 });

    const result = await service.createBooking(
      { ...request, idempotencyKey: KEY },
      { createdByAdminId: 1, createdByAdminName: '직원' },
    );

    expect(result.reservationId).toBe(36);
    expect(reserveRoomAvailability).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('키 없는 관리자 예약(연장 예약)은 예전처럼 조회 없이 새로 만든다', async () => {
    await service.createBooking(request, {
      createdByAdminId: 1,
      createdByAdminName: '직원',
      linkedReservationId: 30,
    });

    expect(findOne).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: null }),
    );
  });
});
