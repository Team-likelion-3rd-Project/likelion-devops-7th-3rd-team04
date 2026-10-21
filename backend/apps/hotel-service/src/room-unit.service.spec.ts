import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { parseApiRpcError } from '@app/common';
import { RoomUnitService } from './room-unit.service';
import { Hotel } from './entities/hotel.entity';
import { RoomType } from './entities/room-type.entity';
import { RoomUnit, RoomUnitStatus } from './entities/room-unit.entity';
import { RoomAvailability } from './entities/room-availability.entity';

// LDP-89: 호실 추가·점검과 보유 수량(= ACTIVE 호실 수)
describe('RoomUnitService', () => {
  const roomType = { roomId: 1, hotelId: 1, name: '디럭스 더블룸' };
  const unit = (overrides: Partial<RoomUnit> = {}) =>
    ({
      roomUnitId: 10,
      roomId: 1,
      hotelId: 1,
      roomNumber: '201',
      floor: 2,
      status: RoomUnitStatus.ACTIVE,
      ...overrides,
    }) as RoomUnit;

  // 트랜잭션 안의 manager
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    maximum: jest.Mock;
    update: jest.Mock;
  };
  let service: RoomUnitService;

  const codeOf = (error: unknown) => parseApiRpcError(error)?.code;

  beforeEach(() => {
    manager = {
      findOne: jest.fn(),
      create: jest.fn((_entity, data: Partial<RoomUnit>) => data),
      save: jest.fn((data: Partial<RoomUnit>) =>
        Promise.resolve({ roomUnitId: 10, ...data }),
      ),
      count: jest.fn(),
      maximum: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    manager.findOne.mockImplementation((entity: unknown) =>
      Promise.resolve(entity === RoomType ? roomType : unit()),
    );
    service = new RoomUnitService(
      {} as Repository<Hotel>,
      {
        find: jest.fn().mockResolvedValue([roomType]),
        manager,
      } as unknown as Repository<RoomType>,
      {} as Repository<RoomUnit>,
      {
        transaction: (work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
      } as unknown as DataSource,
    );
  });

  describe('createUnit (호실 추가)', () => {
    it('ACTIVE로 만들고 보유 수량을 ACTIVE 호실 수로 다시 맞춘다', async () => {
      manager.count.mockResolvedValue(3);

      const result = await service.createUnit({
        hotelId: 1,
        roomId: 1,
        roomNumber: ' 201 ',
        floor: 2,
      });

      expect(result).toMatchObject({
        roomNumber: '201',
        roomName: '디럭스 더블룸',
        status: 'ACTIVE',
      });
      // 객실 종류 행을 잠그고 수량을 센다
      expect(manager.findOne).toHaveBeenCalledWith(
        RoomType,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        RoomType,
        { roomId: 1 },
        { totalCount: 3 },
      );
    });

    it('같은 지점에 같은 방 번호가 있으면 409 ROOM_NUMBER_DUPLICATED', async () => {
      const duplicate = new QueryFailedError('INSERT', [], {
        code: 'ER_DUP_ENTRY',
      } as unknown as Error);
      manager.save.mockRejectedValue(duplicate);

      const error = await service
        .createUnit({ hotelId: 1, roomId: 1, roomNumber: '201' })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('ROOM_NUMBER_DUPLICATED');
    });

    it('다른 지점의 객실 종류면 404 ROOM_NOT_FOUND', async () => {
      manager.findOne.mockResolvedValue(null);

      const error = await service
        .createUnit({ hotelId: 2, roomId: 1, roomNumber: '201' })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('ROOM_NOT_FOUND');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('방 번호가 비어 있으면 400 INVALID_ROOM_NUMBER', async () => {
      const error = await service
        .createUnit({ hotelId: 1, roomId: 1, roomNumber: '  ' })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('INVALID_ROOM_NUMBER');
    });
  });

  describe('setStatus (점검 처리·해제)', () => {
    const setOutOfService = () =>
      service.setStatus({
        hotelId: 1,
        roomUnitId: 10,
        status: 'OUT_OF_SERVICE',
      });

    it('점검하면 남는 방보다 이미 받은 예약이 많은 날이 있으면 409 ROOM_UNIT_OVERBOOKING', async () => {
      manager.count.mockResolvedValue(2); // 점검 후 1개
      manager.maximum.mockResolvedValue(2); // 어느 날 예약 2건

      const error = await setOutOfService().catch((e: unknown) => e);

      expect(codeOf(error)).toBe('ROOM_UNIT_OVERBOOKING');
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      // 오늘 이후 날짜만 본다
      expect(manager.maximum).toHaveBeenCalledWith(
        RoomAvailability,
        'bookedCount',
        expect.objectContaining({ roomId: 1 }),
      );
    });

    it('예약 수가 남는 방 이하면 점검하고 보유 수량을 줄인다', async () => {
      manager.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      manager.maximum.mockResolvedValue(1);

      const result = await setOutOfService();

      expect(result.status).toBe('OUT_OF_SERVICE');
      expect(manager.update).toHaveBeenCalledWith(
        RoomType,
        { roomId: 1 },
        { totalCount: 1 },
      );
    });

    it('호실 행을 잠그는 읽기로 시작한다 (락을 기다린 뒤 최신 수량으로 판단)', async () => {
      manager.count.mockResolvedValue(2);
      manager.maximum.mockResolvedValue(0);

      await setOutOfService();

      expect(manager.findOne.mock.calls[0]).toEqual([
        RoomUnit,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      ]);
    });

    it('점검 해제는 오버부킹 검사 없이 보유 수량을 늘린다', async () => {
      manager.findOne.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === RoomType
            ? roomType
            : unit({ status: RoomUnitStatus.OUT_OF_SERVICE }),
        ),
      );
      manager.count.mockResolvedValue(3);

      const result = await service.setStatus({
        hotelId: 1,
        roomUnitId: 10,
        status: 'ACTIVE',
      });

      expect(result.status).toBe('ACTIVE');
      expect(manager.maximum).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(
        RoomType,
        { roomId: 1 },
        { totalCount: 3 },
      );
    });

    it('다른 지점 호실이면 404 ROOM_UNIT_NOT_FOUND', async () => {
      manager.findOne.mockResolvedValue(null);

      const error = await setOutOfService().catch((e: unknown) => e);

      expect(codeOf(error)).toBe('ROOM_UNIT_NOT_FOUND');
    });

    it('상태 값이 잘못되면 400 INVALID_ROOM_UNIT_STATUS', async () => {
      const error = await service
        .setStatus({ hotelId: 1, roomUnitId: 10, status: 'BROKEN' })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('INVALID_ROOM_UNIT_STATUS');
    });
  });
});
