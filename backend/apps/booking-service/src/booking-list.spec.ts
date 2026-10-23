import { DataSource, Repository } from 'typeorm';
import { BookingServiceService } from './booking-service.service';
import { Reservation } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// LDP-136: 관리자 예약 목록 — 조건·페이지 (조건이 없으면 예전처럼 전체)
describe('관리자 예약 목록 getBookings', () => {
  const qb = {
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getManyAndCount: jest.fn(),
  };
  const createQueryBuilder = jest.fn();
  let service: BookingServiceService;

  const whereSql = () => qb.andWhere.mock.calls.map(([sql]) => sql as unknown);

  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of [
      qb.andWhere,
      qb.orderBy,
      qb.addOrderBy,
      qb.skip,
      qb.take,
    ]) {
      fn.mockReturnValue(qb);
    }
    // 예약이 없으면 결제 시도·호실 번호 조회 없이 빈 목록이 된다
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    createQueryBuilder.mockReturnValue(qb);
    service = new BookingServiceService(
      { createQueryBuilder } as unknown as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      {} as DataSource,
      {} as ReservationFacilityService,
      { getService: () => ({}) } as never,
      { getService: () => ({}) } as never,
    );
  });

  it('조건이 없으면 조건·페이지 없이 최신순 전체 + total', async () => {
    qb.getManyAndCount.mockResolvedValue([[], 0]);

    expect(await service.getBookings({})).toEqual({ bookings: [], total: 0 });

    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.skip).not.toHaveBeenCalled();
    expect(qb.orderBy).toHaveBeenCalledWith('r.createdAt', 'DESC');
  });

  it('page·size면 그 페이지만 (3페이지 20개씩 = 40개 건너뜀)', async () => {
    await service.getBookings({ page: 3, size: 20 });

    expect(qb.skip).toHaveBeenCalledWith(40);
    expect(qb.take).toHaveBeenCalledWith(20);
  });

  it('지점·상태·연장 묶음 조건', async () => {
    await service.getBookings({
      hotelId: 1,
      statuses: ['PENDING_PAYMENT', 'RESERVED'],
      linkedTo: 12,
    });

    expect(whereSql()).toEqual([
      'r.hotelId = :hotelId',
      'r.status IN (:...statuses)',
      '(r.reservationId = :linkedTo OR r.linkedReservationId = :linkedTo)',
    ]);
  });

  it('검색어에 맞는 예약번호도 회원도 없으면 DB를 조회하지 않고 빈 목록', async () => {
    expect(
      await service.getBookings({
        hasKeyword: true,
        keywordReservationId: 0,
        keywordUserIds: [],
      }),
    ).toEqual({ bookings: [], total: 0 });

    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('검색어 조건(예약번호 또는 회원)은 하나의 묶음으로 건다 — 다른 조건과는 AND', async () => {
    await service.getBookings({
      hotelId: 1,
      hasKeyword: true,
      keywordReservationId: 12,
      keywordUserIds: [7, 9],
    });

    expect(qb.andWhere).toHaveBeenCalledTimes(2);
    expect(whereSql()[0]).toBe('r.hotelId = :hotelId');
    // 두 번째는 Brackets(예약번호 OR 회원) — 문자열이 아니라 묶음 객체
    expect(typeof whereSql()[1]).toBe('object');
  });
});
