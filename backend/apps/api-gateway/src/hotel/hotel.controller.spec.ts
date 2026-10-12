import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HotelController } from './hotel.controller';

describe('HotelController', () => {
  let controller: HotelController;
  const getHelloMock = jest.fn();
  const getHotelsMock = jest.fn();
  const getHotelMock = jest.fn();
  const updateHotelMock = jest.fn();
  const getRoomsMock = jest.fn();
  const searchRoomsMock = jest.fn();
  const getRoomMock = jest.fn();
  const createRoomMock = jest.fn();
  const updateRoomMock = jest.fn();
  const deleteRoomMock = jest.fn();
  const getRoomAvailabilityMock = jest.fn();

  const hotel = {
    hotelId: 1,
    name: '르메르디앙 서울',
    address: '서울시 강남구',
    phoneNumber: '02-1234-5678',
    description: '5성급 호텔',
  };
  const room = {
    roomId: 1,
    hotelId: 1,
    name: '디럭스 더블룸',
    capacity: 2,
    description: '시티뷰를 갖춘 넓은 더블룸입니다.',
    images: [],
  };
  const availability = {
    hotelId: 1,
    roomId: 1,
    startDate: '2026-08-20',
    endDate: '2026-08-21',
    isAvailable: true,
    availabilities: [
      { date: '2026-08-20', isAvailable: true, price: 100000 },
      { date: '2026-08-21', isAvailable: true, price: 100000 },
    ],
  };

  beforeEach(async () => {
    getHelloMock.mockReturnValue(of({ message: 'Hotel Hello World!' }));
    getHotelsMock.mockReturnValue(of({ hotels: [hotel] }));
    getHotelMock.mockReturnValue(of(hotel));
    updateHotelMock.mockReturnValue(of(hotel));
    getRoomsMock.mockReturnValue(of({ rooms: [room] }));
    searchRoomsMock.mockReturnValue(of({ results: [{ room, minPrice: 90000 }] }));
    getRoomMock.mockReturnValue(of(room));
    createRoomMock.mockReturnValue(of(room));
    updateRoomMock.mockReturnValue(of(room));
    deleteRoomMock.mockReturnValue(of({ success: true }));
    getRoomAvailabilityMock.mockReturnValue(of(availability));

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HotelController],
      providers: [
        {
          provide: 'HOTEL_SERVICE',
          useValue: {
            getService: () => ({
              getHello: getHelloMock,
              getHotels: getHotelsMock,
              getHotel: getHotelMock,
              updateHotel: updateHotelMock,
              getRooms: getRoomsMock,
              searchRooms: searchRoomsMock,
              getRoom: getRoomMock,
              createRoom: createRoomMock,
              updateRoom: updateRoomMock,
              deleteRoom: deleteRoomMock,
              getRoomAvailability: getRoomAvailabilityMock,
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<HotelController>(HotelController);
    controller.onModuleInit();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHotels', () => {
    it('should call hotel-service via gRPC and return the hotel list', async () => {
      const result = await new Promise((resolve) =>
        controller.getHotels().subscribe(resolve),
      );

      expect(getHotelsMock).toHaveBeenCalledWith({});
      expect(result).toEqual({ hotels: [hotel] });
    });
  });

  describe('getHotel', () => {
    it('should look up a hotel by the hotelId path param', async () => {
      const result = await controller.getHotel('1');

      expect(getHotelMock).toHaveBeenCalledWith({ hotelId: 1 });
      expect(result).toEqual(hotel);
    });

    it('should throw NotFoundException when the hotel does not exist', async () => {
      getHotelMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 호텔입니다.' })),
      );

      await expect(controller.getHotel('999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateHotel', () => {
    it('should update the hotel by the hotelId path param', async () => {
      const dto = {
        name: '신라 스테이 서울',
        address: '서울시 중구',
        phoneNumber: '02-9876-5432',
        description: '수정된 설명입니다.',
      };

      const result = await controller.updateHotel(1, dto);

      expect(updateHotelMock).toHaveBeenCalledWith({ hotelId: 1, ...dto });
      expect(result).toEqual(hotel);
    });

    it('should throw NotFoundException when the hotel does not exist', async () => {
      updateHotelMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 호텔입니다.' })),
      );
      const dto = {
        name: '신라 스테이 서울',
        address: '서울시 중구',
        phoneNumber: '02-9876-5432',
      };

      await expect(controller.updateHotel(999, dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getRooms', () => {
    it('should look up rooms by the hotelId path param', async () => {
      const result = await controller.getRooms(1);

      expect(getRoomsMock).toHaveBeenCalledWith({ hotelId: 1 });
      expect(result).toEqual({ rooms: [room] });
    });

    it('should throw NotFoundException when the hotel does not exist', async () => {
      getRoomsMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 호텔입니다.' })),
      );

      await expect(controller.getRooms(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchRooms', () => {
    it('should search rooms by the hotelId path param and query conditions', async () => {
      const query = { checkIn: '2026-09-01', checkOut: '2026-09-03', guests: 2 };

      const result = await controller.searchRooms(1, query);

      expect(searchRoomsMock).toHaveBeenCalledWith({ hotelId: 1, ...query });
      expect(result).toEqual({ results: [{ room, minPrice: 90000 }] });
    });

    it('should throw NotFoundException when the hotel does not exist', async () => {
      searchRoomsMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 호텔입니다.' })),
      );
      const query = { checkIn: '2026-09-01', checkOut: '2026-09-03', guests: 2 };

      await expect(controller.searchRooms(999, query)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when checkOut is not after checkIn without calling gRPC', async () => {
      const query = { checkIn: '2026-09-03', checkOut: '2026-09-01', guests: 2 };
      searchRoomsMock.mockClear();

      await expect(controller.searchRooms(1, query)).rejects.toThrow(
        BadRequestException,
      );
      expect(searchRoomsMock).not.toHaveBeenCalled();
    });
  });

  describe('getRoom', () => {
    it('should look up a room by the hotelId/roomId path params', async () => {
      const result = await controller.getRoom(1, 1);

      expect(getRoomMock).toHaveBeenCalledWith({ hotelId: 1, roomId: 1 });
      expect(result).toEqual(room);
    });

    it('should throw NotFoundException when the room does not exist', async () => {
      getRoomMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 객실입니다.' })),
      );

      await expect(controller.getRoom(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createRoom', () => {
    it('should register a new room under the hotel', async () => {
      const dto = {
        name: '디럭스 더블룸',
        capacity: 2,
        description: '시티뷰를 갖춘 넓은 더블룸입니다.',
      };

      const result = await controller.createRoom(1, dto);

      expect(createRoomMock).toHaveBeenCalledWith({ hotelId: 1, ...dto });
      expect(result).toEqual(room);
    });

    it('should throw NotFoundException when the hotel does not exist', async () => {
      createRoomMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 호텔입니다.' })),
      );
      const dto = { name: '디럭스 더블룸', capacity: 2 };

      await expect(controller.createRoom(999, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should pass images through to hotel-service', async () => {
      const dto = {
        name: '디럭스 더블룸',
        capacity: 2,
        description: '시티뷰를 갖춘 넓은 더블룸입니다.',
        images: [{ mimeType: 'image/jpeg', imageBase64: 'AAA' }],
      };

      await controller.createRoom(1, dto);

      expect(createRoomMock).toHaveBeenCalledWith({ hotelId: 1, ...dto });
    });
  });

  describe('updateRoom', () => {
    it('should update an existing room under the hotel', async () => {
      const dto = {
        name: '디럭스 더블룸',
        capacity: 2,
        description: '시티뷰를 갖춘 넓은 더블룸입니다.',
      };

      const result = await controller.updateRoom(1, 1, dto);

      expect(updateRoomMock).toHaveBeenCalledWith({
        hotelId: 1,
        roomId: 1,
        ...dto,
      });
      expect(result).toEqual(room);
    });

    it('should throw NotFoundException when the room does not exist', async () => {
      updateRoomMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 객실입니다.' })),
      );
      const dto = { name: '디럭스 더블룸', capacity: 2 };

      await expect(controller.updateRoom(1, 999, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should pass images through to hotel-service (full replace)', async () => {
      const dto = {
        name: '디럭스 더블룸',
        capacity: 2,
        description: '시티뷰를 갖춘 넓은 더블룸입니다.',
        images: [{ mimeType: 'image/jpeg', imageBase64: 'AAA' }],
      };

      await controller.updateRoom(1, 1, dto);

      expect(updateRoomMock).toHaveBeenCalledWith({
        hotelId: 1,
        roomId: 1,
        ...dto,
      });
    });
  });

  describe('deleteRoom', () => {
    it('should delete the room by the hotelId/roomId path params', async () => {
      const result = await controller.deleteRoom(1, 1);

      expect(deleteRoomMock).toHaveBeenCalledWith({ hotelId: 1, roomId: 1 });
      expect(result).toEqual({ message: '객실이 삭제되었습니다.' });
    });

    it('should throw NotFoundException when the room does not exist', async () => {
      deleteRoomMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 객실입니다.' })),
      );

      await expect(controller.deleteRoom(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getRoomAvailability', () => {
    it('should look up availability for the hotelId/roomId path params and date range', async () => {
      const query = { startDate: '2026-08-20', endDate: '2026-08-21' };

      const result = await controller.getRoomAvailability(1, 1, query);

      expect(getRoomAvailabilityMock).toHaveBeenCalledWith({
        hotelId: 1,
        roomId: 1,
        ...query,
      });
      expect(result).toEqual(availability);
    });

    it('should throw NotFoundException when the room does not exist', async () => {
      getRoomAvailabilityMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 객실입니다.' })),
      );
      const query = { startDate: '2026-08-20', endDate: '2026-08-21' };

      await expect(
        controller.getRoomAvailability(1, 999, query),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when startDate is after endDate without calling gRPC', async () => {
      const query = { startDate: '2026-08-21', endDate: '2026-08-20' };
      getRoomAvailabilityMock.mockClear();

      await expect(controller.getRoomAvailability(1, 1, query)).rejects.toThrow(
        BadRequestException,
      );
      expect(getRoomAvailabilityMock).not.toHaveBeenCalled();
    });
  });
});
