import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Between, DataSource, MoreThan, MoreThanOrEqual } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { HotelServiceController } from './hotel-service.controller';
import { HotelServiceService } from './hotel-service.service';
import { RoomService } from './room.service';
import { FacilityService } from './facility.service';
import { Hotel } from './entities/hotel.entity';
import { RoomType } from './entities/room-type.entity';
import { RoomUnit } from './entities/room-unit.entity';
import { RoomAvailability } from './entities/room-availability.entity';
import { RoomImage } from './entities/room-image.entity';
import { RoomImageStorage } from './room-image.storage';

describe('HotelServiceController', () => {
  let hotelServiceController: HotelServiceController;
  let hotelRepository: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let roomRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let roomUnitRepository: { count: jest.Mock };
  let roomAvailabilityRepository: {
    find: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    decrement: jest.Mock;
    maximum: jest.Mock;
  };
  // reserveRoomAvailability가 쓰는 트랜잭션 안의 manager
  let manager: { findOne: jest.Mock; find: jest.Mock; increment: jest.Mock };
  let roomImageRepository: {
    find: jest.Mock;
    delete: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  // 객실 사진 저장소(MinIO·S3) — 실제 저장소 없이 Presigned URL·업로드 확인 결과만 흉내 낸다
  let roomImageStorage: {
    createUploadUrl: jest.Mock;
    createViewUrl: jest.Mock;
    getUploadedImageType: jest.Mock;
    deleteObjects: jest.Mock;
  };

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
    totalCount: 1,
    description: '시티뷰를 갖춘 넓은 더블룸입니다.',
  };

  beforeEach(async () => {
    hotelRepository = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
    roomRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    roomUnitRepository = { count: jest.fn().mockResolvedValue(0) };
    roomAvailabilityRepository = {
      find: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      decrement: jest.fn().mockResolvedValue({ affected: 1 }),
      maximum: jest.fn().mockResolvedValue(null),
    };
    manager = {
      findOne: jest.fn(),
      find: jest.fn(),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = {
      transaction: (work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
    };
    roomImageRepository = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((entity: Partial<RoomImage>) => entity),
      save: jest.fn((entities: Partial<RoomImage>[]) =>
        Promise.resolve(entities),
      ),
    };
    roomImageStorage = {
      createUploadUrl: jest.fn(),
      createViewUrl: jest.fn((objectKey: string) =>
        Promise.resolve(`https://storage.test/${objectKey}?signed`),
      ),
      getUploadedImageType: jest.fn().mockResolvedValue('image/jpeg'),
      deleteObjects: jest.fn().mockResolvedValue(undefined),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [HotelServiceController],
      providers: [
        HotelServiceService,
        RoomService,
        { provide: FacilityService, useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Hotel), useValue: hotelRepository },
        { provide: getRepositoryToken(RoomType), useValue: roomRepository },
        {
          provide: getRepositoryToken(RoomUnit),
          useValue: roomUnitRepository,
        },
        {
          provide: getRepositoryToken(RoomAvailability),
          useValue: roomAvailabilityRepository,
        },
        {
          provide: getRepositoryToken(RoomImage),
          useValue: roomImageRepository,
        },
        { provide: RoomImageStorage, useValue: roomImageStorage },
      ],
    }).compile();

    hotelServiceController = app.get<HotelServiceController>(
      HotelServiceController,
    );
  });

  describe('root', () => {
    it('should return "Hotel Hello World!"', () => {
      expect(hotelServiceController.getHello()).toEqual({
        message: 'Hotel Hello World!',
      });
    });
  });

  describe('updateHotel', () => {
    it('should update and save the hotel when it exists', async () => {
      const existingHotel = { ...hotel };
      hotelRepository.findOne.mockResolvedValue(existingHotel);
      hotelRepository.save.mockImplementation((h: typeof existingHotel) =>
        Promise.resolve(h),
      );

      const result = await hotelServiceController.updateHotel({
        hotelId: 1,
        name: '신라 스테이 서울',
        address: '서울시 중구',
        phoneNumber: '02-9876-5432',
        description: '수정된 설명입니다.',
      });

      expect(hotelRepository.findOne).toHaveBeenCalledWith({
        where: { hotelId: 1 },
      });
      expect(hotelRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hotelId: 1,
          name: '신라 스테이 서울',
          address: '서울시 중구',
          phoneNumber: '02-9876-5432',
          description: '수정된 설명입니다.',
        }),
      );
      expect(result).toEqual({
        hotelId: 1,
        name: '신라 스테이 서울',
        address: '서울시 중구',
        phoneNumber: '02-9876-5432',
        description: '수정된 설명입니다.',
      });
    });

    it('should throw RpcException when the hotel does not exist', async () => {
      hotelRepository.findOne.mockResolvedValue(null);

      await expect(
        hotelServiceController.updateHotel({
          hotelId: 999,
          name: '신라 스테이 서울',
          address: '서울시 중구',
          phoneNumber: '02-9876-5432',
          description: '수정된 설명입니다.',
        }),
      ).rejects.toThrow(RpcException);
      expect(hotelRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getRooms', () => {
    it('should return the room list when the hotel exists', async () => {
      hotelRepository.findOne.mockResolvedValue(hotel);
      roomRepository.find.mockResolvedValue([room]);

      const result = await hotelServiceController.getRooms({ hotelId: 1 });

      expect(hotelRepository.findOne).toHaveBeenCalledWith({
        where: { hotelId: 1 },
      });
      expect(roomRepository.find).toHaveBeenCalledWith({
        where: { hotelId: 1 },
      });
      expect(result).toEqual({
        rooms: [
          {
            roomId: 1,
            hotelId: 1,
            name: '디럭스 더블룸',
            capacity: 2,
            totalCount: 1,
            description: '시티뷰를 갖춘 넓은 더블룸입니다.',
            images: [],
          },
        ],
      });
    });

    it('should throw RpcException when the hotel does not exist', async () => {
      hotelRepository.findOne.mockResolvedValue(null);

      await expect(
        hotelServiceController.getRooms({ hotelId: 999 }),
      ).rejects.toThrow(RpcException);
    });

    it('should attach images grouped by roomId, ordered by sortOrder', async () => {
      hotelRepository.findOne.mockResolvedValue(hotel);
      roomRepository.find.mockResolvedValue([room]);
      roomImageRepository.find.mockResolvedValue([
        {
          imageId: 10,
          roomId: 1,
          mimeType: 'image/jpeg',
          objectKey: 'room-types/1/a.jpg',
          sortOrder: 0,
        },
        {
          imageId: 11,
          roomId: 1,
          mimeType: 'image/png',
          objectKey: 'room-types/1/b.png',
          sortOrder: 1,
        },
      ]);

      const result = await hotelServiceController.getRooms({ hotelId: 1 });

      expect(roomImageRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { sortOrder: 'ASC' } }),
      );
      // 사진은 저장소 경로로 만든 보기용 Presigned URL로 내려간다
      expect(result.rooms[0].images).toEqual([
        {
          imageId: 10,
          mimeType: 'image/jpeg',
          imageUrl: 'https://storage.test/room-types/1/a.jpg?signed',
          objectKey: 'room-types/1/a.jpg',
          sortOrder: 0,
        },
        {
          imageId: 11,
          mimeType: 'image/png',
          imageUrl: 'https://storage.test/room-types/1/b.png?signed',
          objectKey: 'room-types/1/b.png',
          sortOrder: 1,
        },
      ]);
    });
  });

  describe('getRoom', () => {
    it('should return the room when it exists', async () => {
      roomRepository.findOne.mockResolvedValue(room);

      const result = await hotelServiceController.getRoom({
        hotelId: 1,
        roomId: 1,
      });

      expect(roomRepository.findOne).toHaveBeenCalledWith({
        where: { hotelId: 1, roomId: 1 },
      });
      expect(result).toEqual({
        roomId: 1,
        hotelId: 1,
        name: '디럭스 더블룸',
        capacity: 2,
        totalCount: 1,
        description: '시티뷰를 갖춘 넓은 더블룸입니다.',
        images: [],
      });
    });

    it('should throw RpcException when the room does not exist', async () => {
      roomRepository.findOne.mockResolvedValue(null);

      await expect(
        hotelServiceController.getRoom({ hotelId: 1, roomId: 999 }),
      ).rejects.toThrow(RpcException);
    });
  });

  describe('searchRooms', () => {
    const roomA = { ...room, roomId: 1, capacity: 2 };
    const roomB = {
      roomId: 2,
      hotelId: 1,
      name: '패밀리 스위트',
      capacity: 4,
      totalCount: 1,
    };

    it('should return only rooms available for every night in the range', async () => {
      hotelRepository.findOne.mockResolvedValue(hotel);
      roomRepository.find.mockResolvedValue([roomA, roomB]);
      roomAvailabilityRepository.find.mockResolvedValue([
        {
          roomId: 1,
          date: '2026-09-01',
          price: 100000,
          isAvailable: true,
          bookedCount: 0,
        },
        {
          roomId: 1,
          date: '2026-09-02',
          price: 90000,
          isAvailable: true,
          bookedCount: 0,
        },
        {
          roomId: 2,
          date: '2026-09-01',
          price: 150000,
          isAvailable: true,
          bookedCount: 0,
        },
        // roomId 2는 09-02 행이 없어 구간을 전부 채우지 못함 -> 제외
      ]);

      const result = await hotelServiceController.searchRooms({
        hotelId: 1,
        checkIn: '2026-09-01',
        checkOut: '2026-09-03',
        guests: 2,
      });

      expect(roomRepository.find).toHaveBeenCalledWith({
        where: { hotelId: 1, capacity: MoreThanOrEqual(2) },
      });
      expect(result.results).toEqual([
        {
          room: expect.objectContaining({ roomId: 1, capacity: 2 }),
          minPrice: 90000,
        },
      ]);
    });

    it('should throw RpcException when the hotel does not exist', async () => {
      hotelRepository.findOne.mockResolvedValue(null);

      await expect(
        hotelServiceController.searchRooms({
          hotelId: 999,
          checkIn: '2026-09-01',
          checkOut: '2026-09-03',
          guests: 2,
        }),
      ).rejects.toThrow(RpcException);
      expect(roomRepository.find).not.toHaveBeenCalled();
    });

    it('should return an empty list when no room meets the capacity condition', async () => {
      hotelRepository.findOne.mockResolvedValue(hotel);
      roomRepository.find.mockResolvedValue([]);

      const result = await hotelServiceController.searchRooms({
        hotelId: 1,
        checkIn: '2026-09-01',
        checkOut: '2026-09-03',
        guests: 10,
      });

      expect(result.results).toEqual([]);
      expect(roomAvailabilityRepository.find).not.toHaveBeenCalled();
    });

    it('판매 중이어도 하루라도 매진(예약 수 = 보유 수량)이면 제외한다', async () => {
      hotelRepository.findOne.mockResolvedValue(hotel);
      roomRepository.find.mockResolvedValue([
        { ...roomA, totalCount: 3 },
        { ...roomB, totalCount: 2 },
      ]);
      roomAvailabilityRepository.find.mockResolvedValue([
        {
          roomId: 1,
          date: '2026-09-01',
          price: 100000,
          isAvailable: true,
          bookedCount: 2,
        },
        {
          roomId: 1,
          date: '2026-09-02',
          price: 100000,
          isAvailable: true,
          bookedCount: 0,
        },
        {
          roomId: 2,
          date: '2026-09-01',
          price: 150000,
          isAvailable: true,
          bookedCount: 2,
        }, // 매진
        {
          roomId: 2,
          date: '2026-09-02',
          price: 150000,
          isAvailable: true,
          bookedCount: 0,
        },
      ]);

      const result = await hotelServiceController.searchRooms({
        hotelId: 1,
        checkIn: '2026-09-01',
        checkOut: '2026-09-03',
        guests: 2,
      });

      expect(result.results.map((r) => r.room.roomId)).toEqual([1]);
    });
  });

  describe('updateRoom', () => {
    it('should update and save the room when it exists', async () => {
      const existingRoom = { ...room };
      roomRepository.findOne.mockResolvedValue(existingRoom);
      roomRepository.save.mockImplementation((r) => Promise.resolve(r));

      const result = await hotelServiceController.updateRoom({
        hotelId: 1,
        roomId: 1,
        name: '스탠다드 트윈룸',
        capacity: 3,
        description: '수정된 설명입니다.',
      });

      expect(roomRepository.findOne).toHaveBeenCalledWith({
        where: { hotelId: 1, roomId: 1 },
      });
      expect(roomRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 1,
          hotelId: 1,
          name: '스탠다드 트윈룸',
          capacity: 3,
          description: '수정된 설명입니다.',
        }),
      );
      expect(result).toEqual({
        roomId: 1,
        hotelId: 1,
        name: '스탠다드 트윈룸',
        capacity: 3,
        totalCount: 1,
        description: '수정된 설명입니다.',
        images: [],
      });
    });

    it('should throw RpcException when the room does not exist', async () => {
      roomRepository.findOne.mockResolvedValue(null);

      await expect(
        hotelServiceController.updateRoom({
          hotelId: 1,
          roomId: 999,
          name: '스탠다드 트윈룸',
          capacity: 3,
          description: '수정된 설명입니다.',
        }),
      ).rejects.toThrow(RpcException);
      expect(roomRepository.save).not.toHaveBeenCalled();
    });

    it('should replace existing images with the provided list', async () => {
      const existingRoom = { ...room };
      roomRepository.findOne.mockResolvedValue(existingRoom);
      roomRepository.save.mockImplementation((r) => Promise.resolve(r));
      // 기존 사진 2장 중 kept.jpg만 새 목록에 남는다
      roomImageRepository.find.mockResolvedValueOnce([
        { roomId: 1, objectKey: 'room-types/1/kept.jpg' },
        { roomId: 1, objectKey: 'room-types/1/removed.jpg' },
      ]);

      const result = await hotelServiceController.updateRoom({
        hotelId: 1,
        roomId: 1,
        name: '스탠다드 트윈룸',
        capacity: 3,
        description: '수정된 설명입니다.',
        images: [
          { objectKey: 'room-types/1/new.jpg' },
          { objectKey: 'room-types/1/kept.jpg' },
        ],
      });

      // 파일 형식은 브라우저가 보낸 값이 아니라 저장소에 올라간 파일에서 읽는다
      expect(roomImageStorage.getUploadedImageType).toHaveBeenCalledWith(
        1,
        'room-types/1/new.jpg',
      );
      expect(roomImageRepository.delete).toHaveBeenCalledWith({ roomId: 1 });
      expect(roomImageRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          roomId: 1,
          mimeType: 'image/jpeg',
          objectKey: 'room-types/1/new.jpg',
          sortOrder: 0,
        }),
        expect.objectContaining({
          objectKey: 'room-types/1/kept.jpg',
          sortOrder: 1,
        }),
      ]);
      // 새 목록에 없는 기존 사진만 저장소에서 지운다
      expect(roomImageStorage.deleteObjects).toHaveBeenCalledWith([
        'room-types/1/removed.jpg',
      ]);
      expect(result.images[0]).toEqual(
        expect.objectContaining({
          mimeType: 'image/jpeg',
          imageUrl: 'https://storage.test/room-types/1/new.jpg?signed',
          objectKey: 'room-types/1/new.jpg',
          sortOrder: 0,
        }),
      );
    });

    it('should not touch the room or its images when an image was not uploaded', async () => {
      roomRepository.findOne.mockResolvedValue({ ...room });
      roomImageStorage.getUploadedImageType.mockRejectedValue(
        new RpcException('업로드되지 않은 이미지입니다.'),
      );

      await expect(
        hotelServiceController.updateRoom({
          hotelId: 1,
          roomId: 1,
          name: '스탠다드 트윈룸',
          capacity: 3,
          description: '수정된 설명입니다.',
          images: [{ objectKey: 'room-types/1/missing.jpg' }],
        }),
      ).rejects.toThrow(RpcException);
      expect(roomRepository.save).not.toHaveBeenCalled();
      expect(roomImageRepository.delete).not.toHaveBeenCalled();
      expect(roomImageStorage.deleteObjects).not.toHaveBeenCalled();
    });
  });

  describe('createRoomImageUploadUrl', () => {
    it('should issue an upload URL under the room path when the room exists', async () => {
      roomRepository.findOne.mockResolvedValue(room);
      const uploadUrl = {
        uploadUrl: 'https://storage.test/room-types/1/x.jpg?signed',
        objectKey: 'room-types/1/x.jpg',
        expiresIn: 300,
      };
      roomImageStorage.createUploadUrl.mockResolvedValue(uploadUrl);

      const result = await hotelServiceController.createRoomImageUploadUrl({
        hotelId: 1,
        roomId: 1,
        mimeType: 'image/jpeg',
        size: 1024,
      });

      expect(roomRepository.findOne).toHaveBeenCalledWith({
        where: { hotelId: 1, roomId: 1 },
      });
      expect(roomImageStorage.createUploadUrl).toHaveBeenCalledWith(
        1,
        'image/jpeg',
        1024,
      );
      expect(result).toEqual(uploadUrl);
    });

    it('should throw RpcException when the room does not exist', async () => {
      roomRepository.findOne.mockResolvedValue(null);

      await expect(
        hotelServiceController.createRoomImageUploadUrl({
          hotelId: 1,
          roomId: 999,
          mimeType: 'image/jpeg',
          size: 1024,
        }),
      ).rejects.toThrow(RpcException);
      expect(roomImageStorage.createUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('deleteRoom', () => {
    it('should delete the room and its child rows when it exists', async () => {
      roomRepository.findOne.mockResolvedValue(room);
      roomImageRepository.find.mockResolvedValueOnce([
        { roomId: 1, objectKey: 'room-types/1/a.jpg' },
      ]);

      const result = await hotelServiceController.deleteRoom({
        hotelId: 1,
        roomId: 1,
      });

      expect(roomRepository.findOne).toHaveBeenCalledWith({
        where: { hotelId: 1, roomId: 1 },
      });
      expect(roomImageRepository.delete).toHaveBeenCalledWith({ roomId: 1 });
      expect(roomAvailabilityRepository.delete).toHaveBeenCalledWith({
        roomId: 1,
      });
      expect(roomRepository.delete).toHaveBeenCalledWith({
        hotelId: 1,
        roomId: 1,
      });
      // 저장소의 사진 파일도 함께 지운다
      expect(roomImageStorage.deleteObjects).toHaveBeenCalledWith([
        'room-types/1/a.jpg',
      ]);
      expect(result).toEqual({ success: true });
    });

    it('should throw RpcException when the room does not exist', async () => {
      roomRepository.findOne.mockResolvedValue(null);

      await expect(
        hotelServiceController.deleteRoom({ hotelId: 1, roomId: 999 }),
      ).rejects.toThrow(RpcException);
      expect(roomRepository.delete).not.toHaveBeenCalled();
      expect(roomImageRepository.delete).not.toHaveBeenCalled();
      expect(roomAvailabilityRepository.delete).not.toHaveBeenCalled();
    });

    it('호실이 남아 있는 객실 종류는 삭제하지 않는다 (V9)', async () => {
      roomRepository.findOne.mockResolvedValue(room);
      roomUnitRepository.count.mockResolvedValue(3);

      await expect(
        hotelServiceController.deleteRoom({ hotelId: 1, roomId: 1 }),
      ).rejects.toThrow(RpcException);
      expect(roomRepository.delete).not.toHaveBeenCalled();
      expect(roomImageRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('getRoomAvailability', () => {
    it('should report overall availability true when every day in range is available', async () => {
      roomRepository.findOne.mockResolvedValue(room);
      roomAvailabilityRepository.find.mockResolvedValue([
        {
          roomId: 1,
          date: '2026-08-20',
          price: 100000,
          isAvailable: true,
          bookedCount: 0,
        },
        {
          roomId: 1,
          date: '2026-08-21',
          price: 100000,
          isAvailable: true,
          bookedCount: 0,
        },
      ]);

      const result = await hotelServiceController.getRoomAvailability({
        hotelId: 1,
        roomId: 1,
        startDate: '2026-08-20',
        endDate: '2026-08-21',
      });

      expect(roomRepository.findOne).toHaveBeenCalledWith({
        where: { hotelId: 1, roomId: 1 },
      });
      expect(roomAvailabilityRepository.find).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        hotelId: 1,
        roomId: 1,
        startDate: '2026-08-20',
        endDate: '2026-08-21',
        isAvailable: true,
        totalCount: 1,
        availabilities: [
          {
            date: '2026-08-20',
            isAvailable: true,
            price: 100000,
            remainingCount: 1,
            isSaleStopped: false,
          },
          {
            date: '2026-08-21',
            isAvailable: true,
            price: 100000,
            remainingCount: 1,
            isSaleStopped: false,
          },
        ],
      });
    });

    it('should report overall availability false when a day is missing or unavailable', async () => {
      roomRepository.findOne.mockResolvedValue(room);
      // 2026-08-21 하루가 비어있어 구간(20~21) 전체가 아님 -> false
      roomAvailabilityRepository.find.mockResolvedValue([
        {
          roomId: 1,
          date: '2026-08-20',
          price: 100000,
          isAvailable: true,
          bookedCount: 0,
        },
      ]);

      const result = await hotelServiceController.getRoomAvailability({
        hotelId: 1,
        roomId: 1,
        startDate: '2026-08-20',
        endDate: '2026-08-21',
      });

      expect(result.isAvailable).toBe(false);
    });

    it('should throw RpcException when the room does not exist', async () => {
      roomRepository.findOne.mockResolvedValue(null);

      await expect(
        hotelServiceController.getRoomAvailability({
          hotelId: 1,
          roomId: 999,
          startDate: '2026-08-20',
          endDate: '2026-08-21',
        }),
      ).rejects.toThrow(RpcException);
      expect(roomAvailabilityRepository.find).not.toHaveBeenCalled();
    });

    it('날짜별로 매진(남은 방 0)과 판매 중지를 구분해서 내려 준다', async () => {
      roomRepository.findOne.mockResolvedValue({ ...room, totalCount: 3 });
      roomAvailabilityRepository.find.mockResolvedValue([
        // 매진: 판매 중인데 남은 방 0
        {
          roomId: 1,
          date: '2026-08-20',
          price: 100000,
          isAvailable: true,
          bookedCount: 3,
        },
        // 판매 중지: 남은 방은 2개지만 관리자가 막음
        {
          roomId: 1,
          date: '2026-08-21',
          price: 100000,
          isAvailable: false,
          bookedCount: 1,
        },
        // 예약 가능
        {
          roomId: 1,
          date: '2026-08-22',
          price: 100000,
          isAvailable: true,
          bookedCount: 1,
        },
      ]);

      const result = await hotelServiceController.getRoomAvailability({
        hotelId: 1,
        roomId: 1,
        startDate: '2026-08-20',
        endDate: '2026-08-22',
      });

      expect(result.isAvailable).toBe(false);
      expect(result.totalCount).toBe(3);
      expect(
        result.availabilities.map(
          ({ isAvailable, remainingCount, isSaleStopped }) => ({
            isAvailable,
            remainingCount,
            isSaleStopped,
          }),
        ),
      ).toEqual([
        { isAvailable: false, remainingCount: 0, isSaleStopped: false },
        { isAvailable: false, remainingCount: 2, isSaleStopped: true },
        { isAvailable: true, remainingCount: 2, isSaleStopped: false },
      ]);
    });
  });

  // LDP-62: 객실 타입별 보유 수량(재고)
  describe('reserveRoomAvailability (예약 → 날짜별 예약 수 +1)', () => {
    const reserve = () =>
      hotelServiceController.reserveRoomAvailability({
        roomId: 1,
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      });
    const day = (date: string, overrides: Record<string, unknown> = {}) => ({
      roomId: 1,
      date,
      price: 100000,
      isAvailable: true,
      bookedCount: 0,
      ...overrides,
    });

    it('남은 방이 있으면 날짜별 예약 수를 1씩 올리고 가격 합계를 돌려준다 (판매 상태는 그대로)', async () => {
      manager.findOne.mockResolvedValue({ ...room, totalCount: 3 });
      manager.find.mockResolvedValue([
        day('2026-09-01', { bookedCount: 2 }),
        day('2026-09-02', { price: 90000 }),
      ]);

      const result = await reserve();

      expect(result).toEqual({ totalAmount: 190000 });
      expect(manager.find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.increment).toHaveBeenCalledWith(
        expect.anything(),
        { roomId: 1, date: Between('2026-09-01', '2026-09-02') },
        'bookedCount',
        1,
      );
      expect(roomAvailabilityRepository.update).not.toHaveBeenCalled();
    });

    it('하루라도 매진(예약 수 = 보유 수량)이면 거절한다 — N개면 N+1번째 예약 불가', async () => {
      manager.findOne.mockResolvedValue({ ...room, totalCount: 3 });
      manager.find.mockResolvedValue([
        day('2026-09-01', { bookedCount: 3 }),
        day('2026-09-02'),
      ]);

      await expect(reserve()).rejects.toThrow(RpcException);
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('남은 방이 있어도 판매 중지한 날짜가 있으면 거절한다', async () => {
      manager.findOne.mockResolvedValue({ ...room, totalCount: 3 });
      manager.find.mockResolvedValue([
        day('2026-09-01', { isAvailable: false }),
        day('2026-09-02'),
      ]);

      await expect(reserve()).rejects.toThrow(RpcException);
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('달력 행이 빠진 날짜가 있으면 거절한다', async () => {
      manager.findOne.mockResolvedValue({ ...room, totalCount: 3 });
      manager.find.mockResolvedValue([day('2026-09-01')]);

      await expect(reserve()).rejects.toThrow(RpcException);
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('존재하지 않는 객실이면 거절한다', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(reserve()).rejects.toThrow(RpcException);
      expect(manager.find).not.toHaveBeenCalled();
    });
  });

  describe('releaseRoomAvailability (예약 취소 → 날짜별 예약 수 -1)', () => {
    it('예약 수가 0보다 큰 날짜만 1씩 내리고, 판매 중지 여부는 건드리지 않는다', async () => {
      const result = await hotelServiceController.releaseRoomAvailability({
        roomId: 1,
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      });

      expect(result).toEqual({ success: true });
      expect(roomAvailabilityRepository.decrement).toHaveBeenCalledWith(
        {
          roomId: 1,
          date: Between('2026-09-01', '2026-09-02'),
          bookedCount: MoreThan(0),
        },
        'bookedCount',
        1,
      );
      expect(roomAvailabilityRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('setRoomAvailability (관리자 판매 중지/재개)', () => {
    it('판매 상태만 바꾸고 예약 수는 건드리지 않는다', async () => {
      await hotelServiceController.setRoomAvailability({
        roomId: 1,
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        isAvailable: false,
      });

      expect(roomAvailabilityRepository.update).toHaveBeenCalledWith(
        { roomId: 1, date: Between('2026-09-01', '2026-09-02') },
        { isAvailable: false },
      );
      expect(roomAvailabilityRepository.decrement).not.toHaveBeenCalled();
    });
  });

  describe('updateRoom 보유 수량(totalCount)', () => {
    const update = (totalCount?: number) =>
      hotelServiceController.updateRoom({
        hotelId: 1,
        roomId: 1,
        name: '디럭스 더블룸',
        capacity: 2,
        totalCount,
        description: '',
      });

    beforeEach(() => {
      roomRepository.findOne.mockResolvedValue({ ...room, totalCount: 5 });
      roomRepository.save.mockImplementation((r) => Promise.resolve(r));
    });

    it('보유 수량을 보내면 바꾼다', async () => {
      roomAvailabilityRepository.maximum.mockResolvedValue(2);

      const result = await update(10);

      expect(result.totalCount).toBe(10);
    });

    it('보유 수량을 안 보내면(0) 기존 값을 유지한다', async () => {
      const result = await update(0);

      expect(result.totalCount).toBe(5);
      expect(roomAvailabilityRepository.maximum).not.toHaveBeenCalled();
    });

    it('오늘 이후 이미 예약된 수보다 적게 줄이려 하면 거절한다', async () => {
      roomAvailabilityRepository.maximum.mockResolvedValue(4);

      await expect(update(3)).rejects.toThrow(RpcException);
      expect(roomRepository.save).not.toHaveBeenCalled();
    });
  });
});
