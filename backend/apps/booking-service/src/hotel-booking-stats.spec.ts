import { DataSource, Repository } from 'typeorm';
import { BookingServiceService } from './booking-service.service';
import { Reservation } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// LDP-254: 관리자 "오늘 객실 점유율"의 분자(occupiedRoomsToday)는 오늘 밤 숙박 중인 확정 예약 건수다.
// roomId는 객실 종류라서 DISTINCT roomId로 세면 같은 종류를 여러 개 예약해도 1개로 합쳐졌다.
describe('호텔별 지표 getHotelBookingStats', () => {
  // getHotelBookingStats는 지표마다 QueryBuilder를 새로 만든다 → 만들 때마다 조건을 따로 기록한다
  const builders: { where: string[]; select: jest.Mock }[] = [];
  let service: BookingServiceService;

  // 오늘 숙박 중(checkIn <= 오늘 < checkOut)인 확정 예약이 3건이라고 가정
  const STAYING_TONIGHT = 3;

  beforeEach(() => {
    builders.length = 0;
    const createQueryBuilder = jest.fn(() => {
      const where: string[] = [];
      const qb: Record<string, jest.Mock> = {};
      const chain = (sql?: string) => {
        if (sql) where.push(sql);
        return qb;
      };
      Object.assign(qb, {
        where: jest.fn(chain),
        andWhere: jest.fn(chain),
        select: jest.fn(() => qb),
        getCount: jest.fn(() =>
          Promise.resolve(
            where.includes('reservation.checkOutDate > :targetDate')
              ? STAYING_TONIGHT
              : 0,
          ),
        ),
        getRawOne: jest.fn(() => Promise.resolve({ sum: null })),
      });
      builders.push({ where, select: qb.select });
      return qb;
    });
    service = new BookingServiceService(
      { createQueryBuilder } as unknown as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      {} as DataSource,
      {} as ReservationFacilityService,
      { getService: () => ({}) } as never,
      { getService: () => ({}) } as never,
    );
  });

  it('점유 객실 수 = 오늘 숙박 중인 확정 예약 건수 (같은 객실 종류여도 각각 1개)', async () => {
    const stats = await service.getHotelBookingStats(1, '2026-11-09');

    expect(stats.occupiedRoomsToday).toBe(STAYING_TONIGHT);

    const occupancy = builders.find((b) =>
      b.where.includes('reservation.checkOutDate > :targetDate'),
    );
    expect(occupancy?.where).toEqual([
      'reservation.hotelId = :hotelId',
      'reservation.status = :status',
      'reservation.checkInDate <= :targetDate',
      'reservation.checkOutDate > :targetDate',
    ]);
    // 객실 종류(roomId)별로 합치지 않는다
    expect(occupancy?.select).not.toHaveBeenCalled();
  });
});
