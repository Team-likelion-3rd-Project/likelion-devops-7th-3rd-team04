import { DataSource, Repository } from 'typeorm';
import { of } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { BookingServiceService } from './booking-service.service';
import { Reservation } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// LDP-247: 수영장 · 라운지 성인 · 소인 요금 분리
describe('createBooking — 편의시설 성인 · 소인', () => {
  const reserveRoomAvailability = jest.fn();
  const getFacilities = jest.fn();
  const createReservationFacility = jest.fn();
  let service: BookingServiceService;

  const request = {
    userId: 10,
    roomId: 2,
    hotelId: 1,
    checkInDate: '2026-12-01',
    checkOutDate: '2026-12-02',
    guestCount: 3,
  };
  const facilities = [
    { facilityId: 1, name: '수영장', price: 77000 },
    { facilityId: 2, name: '수영장 소인', price: 44000 },
    { facilityId: 3, name: '라운지', price: 80000 },
    { facilityId: 4, name: '라운지 소인', price: 30000 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    reserveRoomAvailability.mockReturnValue(of({ totalAmount: 100000 }));
    getFacilities.mockReturnValue(of({ facilities }));
    createReservationFacility.mockResolvedValue(undefined);
    service = new BookingServiceService(
      {
        create: (r: Partial<Reservation>) => ({ ...r }),
        save: (r: Reservation) =>
          Promise.resolve({ ...r, reservationId: 99, createdAt: new Date() }),
      } as unknown as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      {} as DataSource,
      { createReservationFacility } as unknown as ReservationFacilityService,
      {
        getService: () => ({ reserveRoomAvailability, getFacilities }),
      } as never,
      { getService: () => ({}) } as never,
    );
    service.onModuleInit();
  });

  it('성인 · 소인을 시설별 요금으로 계산하고 시설마다 내역을 남긴다', async () => {
    const result = await service.createBooking({
      ...request,
      poolGuestCount: 2,
      poolChildGuestCount: 1,
      loungeGuestCount: 1,
      loungeChildGuestCount: 2,
    });

    // 100,000 + 77,000×2 + 44,000 + 80,000 + 30,000×2
    expect(result.totalAmount).toBe(438000);
    expect(
      createReservationFacility.mock.calls.map(([input]) => [
        (input as { facilityName: string }).facilityName,
        (input as { guestCount: number }).guestCount,
        (input as { totalAmount: number }).totalAmount,
      ]),
    ).toEqual([
      ['수영장', 2, 154000],
      ['수영장 소인', 1, 44000],
      ['라운지', 1, 80000],
      ['라운지 소인', 2, 60000],
    ]);
  });

  it('소인 필드 없이 보낸 요청은 기존처럼 성인 요금으로 계산한다', async () => {
    const result = await service.createBooking({
      ...request,
      poolGuestCount: 1,
    });

    expect(result.totalAmount).toBe(177000);
    expect(createReservationFacility).toHaveBeenCalledTimes(1);
  });

  it('소인만 이용해도 된다', async () => {
    const result = await service.createBooking({
      ...request,
      loungeChildGuestCount: 1,
    });

    expect(result.totalAmount).toBe(130000);
  });

  it('시설별 인원이 투숙 인원과 같으면 허용한다', async () => {
    await expect(
      service.createBooking({
        ...request,
        poolGuestCount: 2,
        poolChildGuestCount: 1,
        loungeGuestCount: 1,
        loungeChildGuestCount: 2,
      }),
    ).resolves.toBeDefined();
  });

  describe('시설별 인원이 투숙 인원을 넘으면 재고를 건드리지 않고 거절', () => {
    it.each([
      ['수영장', { poolGuestCount: 2, poolChildGuestCount: 2 }],
      ['라운지', { loungeGuestCount: 3, loungeChildGuestCount: 1 }],
    ])('%s', async (_, counts) => {
      const thrown: unknown = await service
        .createBooking({ ...request, ...counts })
        .catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect((thrown as RpcException).getError()).toMatchObject({
        code: GrpcStatus.INVALID_ARGUMENT,
      });
      expect(reserveRoomAvailability).not.toHaveBeenCalled();
    });
  });

  it('관리자 대리 예약의 초과는 오류 코드를 함께 낸다', async () => {
    const thrown: unknown = await service
      .createBooking(
        { ...request, poolGuestCount: 4 },
        { createdByAdminId: 1, createdByAdminName: '직원' },
      )
      .catch((e: unknown) => e);

    expect(JSON.stringify((thrown as RpcException).getError())).toContain(
      'FACILITY_GUEST_COUNT_EXCEEDED',
    );
  });
});
