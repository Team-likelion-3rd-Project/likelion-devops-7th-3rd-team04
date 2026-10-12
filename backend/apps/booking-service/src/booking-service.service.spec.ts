import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { BookingServiceService } from './booking-service.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';

describe('BookingServiceService', () => {
  let service: BookingServiceService;

  const setRoomAvailabilityMock = jest.fn();
  const refundPaymentMock = jest.fn();
  const findOneMock = jest.fn();
  const saveMock = jest.fn();

  const pendingReservation: Partial<Reservation> = {
    reservationId: 1,
    userId: 10,
    roomId: 1,
    checkInDate: '2026-09-01',
    checkOutDate: '2026-09-03',
    status: ReservationStatus.PENDING_PAYMENT,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    setRoomAvailabilityMock.mockReturnValue(of({ success: true }));
    refundPaymentMock.mockReturnValue(of({ refunded: false }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingServiceService,
        {
          provide: getRepositoryToken(Reservation),
          useValue: { findOne: findOneMock, save: saveMock },
        },
        {
          provide: 'HOTEL_SERVICE',
          useValue: {
            getService: () => ({
              setRoomAvailability: setRoomAvailabilityMock,
              reserveRoomAvailability: jest.fn(),
            }),
          },
        },
        {
          provide: 'PAYMENT_SERVICE',
          useValue: {
            getService: () => ({ refundPayment: refundPaymentMock }),
          },
        },
      ],
    }).compile();

    service = module.get<BookingServiceService>(BookingServiceService);
    service.onModuleInit();
  });

  describe('cancelBooking', () => {
    it('PENDING_PAYMENT 상태도 취소할 수 있고, 환불 RPC를 항상 호출한다', async () => {
      findOneMock.mockResolvedValue({ ...pendingReservation });
      saveMock.mockResolvedValue({
        ...pendingReservation,
        status: ReservationStatus.CANCELLED,
      });

      const result = await service.cancelBooking(1, 10);

      expect(result.status).toBe(ReservationStatus.CANCELLED);
      expect(refundPaymentMock).toHaveBeenCalledWith({ reservationId: 1 });
    });

    it('RESERVED 상태도 취소할 수 있다', async () => {
      findOneMock.mockResolvedValue({
        ...pendingReservation,
        status: ReservationStatus.RESERVED,
      });
      saveMock.mockResolvedValue({
        ...pendingReservation,
        status: ReservationStatus.CANCELLED,
      });

      const result = await service.cancelBooking(1, 10);

      expect(result.status).toBe(ReservationStatus.CANCELLED);
      expect(refundPaymentMock).toHaveBeenCalledWith({ reservationId: 1 });
    });

    it('이미 취소된 예약이면 RpcException을 던진다', async () => {
      findOneMock.mockResolvedValue({
        ...pendingReservation,
        status: ReservationStatus.CANCELLED,
      });

      await expect(service.cancelBooking(1, 10)).rejects.toThrow(RpcException);
    });

    it('본인의 예약이 아니면 RpcException을 던진다', async () => {
      findOneMock.mockResolvedValue({ ...pendingReservation, userId: 999 });

      await expect(service.cancelBooking(1, 10)).rejects.toThrow(RpcException);
    });

    it('환불 RPC가 실패해도 예약취소 자체는 성공 처리한다', async () => {
      findOneMock.mockResolvedValue({ ...pendingReservation });
      saveMock.mockResolvedValue({
        ...pendingReservation,
        status: ReservationStatus.CANCELLED,
      });
      refundPaymentMock.mockReturnValue(
        throwError(() => new RpcException('환불 실패')),
      );

      const result = await service.cancelBooking(1, 10);

      expect(result.status).toBe(ReservationStatus.CANCELLED);
    });
  });

  describe('confirmBooking', () => {
    it('PENDING_PAYMENT 상태면 RESERVED로 전환한다', async () => {
      findOneMock.mockResolvedValue({ ...pendingReservation });
      saveMock.mockResolvedValue({
        ...pendingReservation,
        status: ReservationStatus.RESERVED,
      });

      const result = await service.confirmBooking(1);

      expect(result.status).toBe(ReservationStatus.RESERVED);
    });

    it('PENDING_PAYMENT 상태가 아니면 RpcException을 던진다', async () => {
      findOneMock.mockResolvedValue({
        ...pendingReservation,
        status: ReservationStatus.RESERVED,
      });

      await expect(service.confirmBooking(1)).rejects.toThrow(RpcException);
    });

    it('존재하지 않는 예약이면 RpcException을 던진다', async () => {
      findOneMock.mockResolvedValue(null);

      await expect(service.confirmBooking(1)).rejects.toThrow(RpcException);
    });
  });
});
