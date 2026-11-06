import { DataSource, Repository } from 'typeorm';
import { parseApiRpcError } from '@app/common';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// 내 예약 목록 조건·페이지와 단건 조회 (부하 테스트 3일차 11-06 — 예약이 쌓일수록 전체 조회가 느려짐)
describe('BookingServiceService 내 예약 조회', () => {
  const reservationFindOne = jest.fn();
  const attemptFind = jest.fn();
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };
  let service: BookingServiceService;

  const reservation = {
    reservationId: 1,
    userId: 10,
    status: ReservationStatus.PENDING_PAYMENT,
    roomUnitId: null,
  } as unknown as Reservation;

  beforeEach(() => {
    jest.clearAllMocks();
    qb.getManyAndCount.mockResolvedValue([[reservation], 7]);
    attemptFind.mockResolvedValue([]);
    service = new BookingServiceService(
      {
        findOne: reservationFindOne,
        createQueryBuilder: () => qb,
      } as unknown as Repository<Reservation>,
      { find: attemptFind } as unknown as Repository<PaymentAttempt>,
      {} as DataSource,
      {} as ReservationFacilityService,
      { getService: () => ({}) } as never,
      { getService: () => ({}) } as never,
    );
    service.onModuleInit();
  });

  describe('getBookingsByUserId', () => {
    it('조건이 없으면 회원 예약 전체를 최신순으로, 페이지를 나누지 않는다', async () => {
      const result = await service.getBookingsByUserId({ userId: 10 });

      expect(qb.where).toHaveBeenCalledWith('r.userId = :userId', {
        userId: 10,
      });
      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(qb.orderBy).toHaveBeenCalledWith('r.createdAt', 'DESC');
      expect(qb.skip).not.toHaveBeenCalled();
      expect(qb.take).not.toHaveBeenCalled();
      expect(result.total).toBe(7);
      expect(result.bookings).toHaveLength(1);
    });

    it('상태·지점 조건과 페이지를 건다', async () => {
      await service.getBookingsByUserId({
        userId: 10,
        statuses: ['PENDING_PAYMENT'],
        hotelId: 2,
        page: 3,
        size: 5,
      });

      expect(qb.andWhere).toHaveBeenCalledWith('r.status IN (:...statuses)', {
        statuses: ['PENDING_PAYMENT'],
      });
      expect(qb.andWhere).toHaveBeenCalledWith('r.hotelId = :hotelId', {
        hotelId: 2,
      });
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(5);
    });

    it('page만 주면 한 페이지 20개', async () => {
      await service.getBookingsByUserId({ userId: 10, page: 1, size: 0 });

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('결과가 없으면 결제 시도를 조회하지 않는다', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      expect(await service.getBookingsByUserId({ userId: 10 })).toEqual({
        bookings: [],
        total: 0,
      });
      expect(attemptFind).not.toHaveBeenCalled();
    });
  });

  describe('getMyBooking', () => {
    it('본인 예약을 예약 번호와 회원으로 함께 찾는다', async () => {
      reservationFindOne.mockResolvedValue(reservation);

      const booking = await service.getMyBooking(10, 1);

      expect(reservationFindOne).toHaveBeenCalledWith({
        where: { reservationId: 1, userId: 10 },
      });
      expect(booking.reservationId).toBe(1);
    });

    it('없거나 남의 예약이면 404 RESERVATION_NOT_FOUND', async () => {
      reservationFindOne.mockResolvedValue(null);

      const error = await service.getMyBooking(99, 1).catch((e: unknown) => e);

      expect(parseApiRpcError(error)).toMatchObject({
        status: 404,
        code: 'RESERVATION_NOT_FOUND',
      });
    });
  });
});
