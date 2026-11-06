import { DataSource, Repository } from 'typeorm';
import { of, throwError } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { BookingServiceService } from './booking-service.service';
import { Reservation } from './entities/reservation.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// LDP-239: 예약 생성이 재고를 차감한 뒤 실패하면 차감한 재고가 돌아오지 않던 문제.
//  - 편의시설 확인은 재고 차감 "전"에 한다 → 편의시설 단계 실패는 재고를 건드리지 않는다
//  - 재고 차감 뒤 예약 저장이 실패하면 releaseRoomAvailability로 돌려놓고 원래 오류를 던진다
describe('createBooking — 실패 시 재고', () => {
  const reserveRoomAvailability = jest.fn();
  const releaseRoomAvailability = jest.fn();
  const getFacilities = jest.fn();
  const save = jest.fn();
  const createReservationFacility = jest.fn();
  let service: BookingServiceService;

  const request = {
    userId: 10,
    roomId: 2,
    hotelId: 1,
    checkInDate: '2026-12-01',
    checkOutDate: '2026-12-03',
    guestCount: 2,
  };
  const withPool = { ...request, poolGuestCount: 1 };

  const facilities = [
    { facilityId: 7, name: '수영장', price: 30000 },
    { facilityId: 8, name: '라운지', price: 50000 },
  ];

  const errorOf = async (promise: Promise<unknown>) => {
    const thrown = await promise.catch((e: unknown) => e);
    return thrown instanceof RpcException ? thrown.getError() : thrown;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reserveRoomAvailability.mockReturnValue(of({ totalAmount: 200000 }));
    releaseRoomAvailability.mockReturnValue(of({ success: true }));
    getFacilities.mockReturnValue(of({ facilities }));
    save.mockImplementation((r: Reservation) =>
      Promise.resolve({ ...r, reservationId: 99, createdAt: new Date() }),
    );
    createReservationFacility.mockResolvedValue(undefined);

    service = new BookingServiceService(
      {
        create: (r: Partial<Reservation>) => ({ ...r }),
        save,
      } as unknown as Repository<Reservation>,
      {} as Repository<PaymentAttempt>,
      {} as DataSource,
      { createReservationFacility } as unknown as ReservationFacilityService,
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

  describe('편의시설 단계 실패 — 재고를 건드리지 않는다', () => {
    it('편의시설 조회가 실패하면 UNAVAILABLE(→ 503)이고 재고 차감을 부르지 않는다', async () => {
      getFacilities.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.UNAVAILABLE, details: 'boom' })),
      );

      expect(await errorOf(service.createBooking(withPool))).toMatchObject({
        code: GrpcStatus.UNAVAILABLE,
      });
      expect(reserveRoomAvailability).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it('호텔에 없는 편의시설이면 FAILED_PRECONDITION(→ 409)이고 재고 차감을 부르지 않는다', async () => {
      getFacilities.mockReturnValue(
        of({ facilities: [{ facilityId: 8, name: '라운지', price: 50000 }] }),
      );

      expect(await errorOf(service.createBooking(withPool))).toMatchObject({
        code: GrpcStatus.FAILED_PRECONDITION,
        message: '해당 호텔에 등록되지 않은 편의시설입니다: 수영장',
      });
      expect(reserveRoomAvailability).not.toHaveBeenCalled();
    });

    it('편의시설을 고르지 않으면 편의시설 조회 없이 예약한다', async () => {
      await service.createBooking(request);

      expect(getFacilities).not.toHaveBeenCalled();
      expect(reserveRoomAvailability).toHaveBeenCalledTimes(1);
    });
  });

  describe('재고 차감 뒤 예약 저장 실패 — 재고를 돌려놓는다', () => {
    it('저장이 실패하면 같은 객실·기간(체크아웃 전날까지)으로 재고를 1번 돌려놓고 원래 오류를 던진다', async () => {
      const dbError = new Error('DB 연결 끊김');
      save.mockRejectedValue(dbError);

      expect(await errorOf(service.createBooking(withPool))).toBe(dbError);
      expect(releaseRoomAvailability).toHaveBeenCalledTimes(1);
      expect(releaseRoomAvailability).toHaveBeenCalledWith({
        roomId: 2,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
      });
      expect(createReservationFacility).not.toHaveBeenCalled();
    });

    it('재고 반환마저 실패해도 원래 저장 오류를 던진다 (반환 실패는 로그만)', async () => {
      const dbError = new Error('DB 연결 끊김');
      save.mockRejectedValue(dbError);
      releaseRoomAvailability.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.UNAVAILABLE })),
      );

      expect(await errorOf(service.createBooking(request))).toBe(dbError);
    });

    it('재고 차감 자체가 실패하면 돌려놓지 않는다 (차감된 게 없음)', async () => {
      reserveRoomAvailability.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.FAILED_PRECONDITION })),
      );

      await errorOf(service.createBooking(request));

      expect(releaseRoomAvailability).not.toHaveBeenCalled();
    });
  });

  it('정상 예약은 객실 요금 + 편의시설 요금으로 저장하고 편의시설 내역을 남긴다', async () => {
    const result = await service.createBooking({
      ...request,
      poolGuestCount: 2,
      loungeGuestCount: 1,
    });

    // 200,000 + 수영장 30,000×2 + 라운지 50,000×1
    expect(result).toMatchObject({ reservationId: 99, totalAmount: 310000 });
    expect(createReservationFacility).toHaveBeenCalledTimes(2);
    expect(createReservationFacility).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 99,
        facilityName: '수영장',
        guestCount: 2,
        totalAmount: 60000,
      }),
    );
    expect(releaseRoomAvailability).not.toHaveBeenCalled();
  });
});
