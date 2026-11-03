import { Test, TestingModule } from '@nestjs/testing';
import { BookingServiceController } from './booking-service.controller';
import { BookingServiceService } from './booking-service.service';
import { ReservationFacilityService } from './reservation-facility.service';
import { RoomAssignmentService } from './room-assignment.service';
import { AdminBookingService } from './admin-booking.service';

describe('BookingServiceController', () => {
  let controller: BookingServiceController;

  const getHelloMock = jest.fn();
  const getBookingsMock = jest.fn();
  const getBookingsByUserIdMock = jest.fn();
  const cancelBookingMock = jest.fn();
  const getBookingByIdMock = jest.fn();
  const createBookingMock = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingServiceController],
      providers: [
        {
          provide: BookingServiceService,
          useValue: {
            getHello: getHelloMock,
            getBookings: getBookingsMock,
            getBookingsByUserId: getBookingsByUserIdMock,
            cancelBooking: cancelBookingMock,
            getBookingById: getBookingByIdMock,
            createBooking: createBookingMock,
          },
        },
        // 이 테스트에서 부르지 않는 의존성 (컨트롤러 생성에만 필요)
        { provide: ReservationFacilityService, useValue: {} },
        { provide: RoomAssignmentService, useValue: {} },
        { provide: AdminBookingService, useValue: {} },
      ],
    }).compile();

    controller = module.get<BookingServiceController>(BookingServiceController);
  });

  it('getHello는 서비스의 getHello 결과를 message로 감싸 반환한다', () => {
    getHelloMock.mockReturnValue('Booking Hello World!');

    expect(controller.getHello()).toEqual({ message: 'Booking Hello World!' });
  });

  it('getBookingById는 서비스의 getBookingById에 위임한다', async () => {
    const booking = { reservationId: 1 };
    getBookingByIdMock.mockResolvedValue(booking);

    const result = await controller.getBookingById({ reservationId: 1 });

    expect(getBookingByIdMock).toHaveBeenCalledWith(1);
    expect(result).toEqual(booking);
  });
});
