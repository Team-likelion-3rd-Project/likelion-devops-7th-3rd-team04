import { DataSource, Repository } from 'typeorm';
import { ReservationExpiryService } from './reservation-expiry.service';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';

// LDP-92: 결제 마감 지난 결제 대기 예약 자동 만료
describe('ReservationExpiryService.expireOverdue', () => {
  const now = new Date('2026-11-01T03:00:00Z');
  const pending = (reservationId: number) =>
    ({
      reservationId,
      roomId: 1,
      checkInDate: '2026-11-05',
      checkOutDate: '2026-11-06',
      status: ReservationStatus.PENDING_PAYMENT,
    }) as Reservation;

  const find = jest.fn();
  const query = jest.fn();
  const managerFindOne = jest.fn();
  const managerUpdate = jest.fn();
  const findConfirmingAttempt = jest.fn();
  const releaseInventory = jest.fn();
  let lockGranted: number;
  let service: ReservationExpiryService;

  beforeEach(() => {
    jest.clearAllMocks();
    lockGranted = 1;
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('GET_LOCK') ? [{ ok: lockGranted }] : []),
    );
    find.mockResolvedValue([{ reservationId: 1 }]);
    managerFindOne.mockImplementation(
      (_entity: unknown, options: { where: { reservationId: number } }) =>
        Promise.resolve(pending(options.where.reservationId)),
    );
    managerUpdate.mockResolvedValue({ affected: 1 });
    findConfirmingAttempt.mockResolvedValue(null);
    releaseInventory.mockResolvedValue(undefined);
    const manager = { findOne: managerFindOne, update: managerUpdate };
    service = new ReservationExpiryService(
      { find } as unknown as Repository<Reservation>,
      {
        createQueryRunner: () => ({
          connect: jest.fn(),
          release: jest.fn(),
          query,
        }),
        transaction: (work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
      } as unknown as DataSource,
      {
        findConfirmingAttempt,
        releaseInventory,
      } as unknown as BookingServiceService,
    );
  });

  it('마감 지난 결제 대기 예약을 EXPIRED로 바꾸고 재고를 돌려놓는다', async () => {
    find.mockResolvedValue([{ reservationId: 1 }, { reservationId: 2 }]);

    const result = await service.expireOverdue(now);

    expect(result).toEqual({ expired: 2, held: 0, skipped: false });
    expect(managerUpdate).toHaveBeenCalledWith(
      Reservation,
      { reservationId: 1, status: ReservationStatus.PENDING_PAYMENT },
      { status: ReservationStatus.EXPIRED },
    );
    expect(releaseInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 1,
        status: ReservationStatus.EXPIRED,
      }),
      '결제 마감 만료',
    );
    expect(releaseInventory).toHaveBeenCalledTimes(2);
    // 행을 잠그고 다시 확인한다
    expect(managerFindOne).toHaveBeenCalledWith(
      Reservation,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('결제 확인 중(CONFIRMING)이면 만료를 보류한다', async () => {
    findConfirmingAttempt.mockResolvedValue({ attemptId: '3' });

    const result = await service.expireOverdue(now);

    expect(result).toEqual({ expired: 0, held: 1, skipped: false });
    expect(managerUpdate).not.toHaveBeenCalled();
    expect(releaseInventory).not.toHaveBeenCalled();
  });

  it('잠근 뒤 보니 그 사이 결제 완료·취소됐으면 건너뛴다', async () => {
    managerFindOne.mockResolvedValue(null);

    const result = await service.expireOverdue(now);

    expect(result).toEqual({ expired: 0, held: 0, skipped: false });
    expect(managerUpdate).not.toHaveBeenCalled();
  });

  it('다른 인스턴스가 배치를 돌리는 중이면(GET_LOCK 실패) 아무것도 하지 않는다', async () => {
    lockGranted = 0;

    const result = await service.expireOverdue(now);

    expect(result).toEqual({ expired: 0, held: 0, skipped: true });
    expect(find).not.toHaveBeenCalled();
  });

  it('끝나면 잠금을 푼다', async () => {
    await service.expireOverdue(now);

    expect(query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', [
      'booking:reservation-expiry',
    ]);
  });
});
