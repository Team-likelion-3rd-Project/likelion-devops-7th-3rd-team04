import { MoreThanOrEqual, Repository } from 'typeorm';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';

// LDP-95: 회원의 이용 예정 예약 수 (탈퇴 전 확인용)
describe('BookingServiceService.countUpcomingReservations', () => {
  const count = jest.fn();
  let service: BookingServiceService;

  beforeEach(() => {
    jest.useFakeTimers();
    count.mockReset().mockResolvedValue(1);
    service = new BookingServiceService(
      { count } as unknown as Repository<Reservation>,
      {} as never,
      {} as never,
      {} as never,
      { getService: () => ({}) } as never,
      { getService: () => ({}) } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('결제 대기 전부 + 체크아웃이 오늘(한국 날짜) 이후인 예약 확정을 센다', async () => {
    jest.setSystemTime(new Date('2026-11-01T03:00:00Z')); // KST 11-01 12:00

    expect(await service.countUpcomingReservations(7)).toBe(1);
    expect(count).toHaveBeenCalledWith({
      where: [
        { userId: 7, status: ReservationStatus.PENDING_PAYMENT },
        {
          userId: 7,
          status: ReservationStatus.RESERVED,
          checkOutDate: MoreThanOrEqual('2026-11-01'),
        },
      ],
    });
  });

  it('한국 새벽(UTC로는 전날)에도 한국 날짜 기준으로 판단한다', async () => {
    jest.setSystemTime(new Date('2026-10-31T16:30:00Z')); // KST 11-01 01:30

    await service.countUpcomingReservations(7);

    expect(count).toHaveBeenCalledWith({
      where: expect.arrayContaining([
        expect.objectContaining({
          checkOutDate: MoreThanOrEqual('2026-11-01'),
        }),
      ]) as unknown,
    });
  });
});
