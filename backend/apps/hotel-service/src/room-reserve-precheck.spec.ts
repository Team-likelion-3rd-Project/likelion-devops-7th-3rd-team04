import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Between, DataSource, Repository } from 'typeorm';
import { ReadCache } from '@app/common';
import { RoomService } from './room.service';
import { RoomImageStorage } from './room-image.storage';
import { Hotel } from './entities/hotel.entity';
import { RoomType } from './entities/room-type.entity';
import { RoomUnit } from './entities/room-unit.entity';
import { RoomAvailability } from './entities/room-availability.entity';
import { RoomImage } from './entities/room-image.entity';

// LDP-245: 매진 요청은 잠금 트랜잭션에 들어가지 않고, 최종 판정은 잠금 안에서 한다
describe('RoomService.reserveRoomAvailability 매진 사전 확인', () => {
  const room = { roomId: 1, totalCount: 2 };
  const day = (date: string, bookedCount = 0, isAvailable = true) => ({
    roomId: 1,
    date,
    price: 100000,
    isAvailable,
    bookedCount,
  });
  const SOLD_OUT = {
    code: GrpcStatus.FAILED_PRECONDITION,
    message: '예약 불가능한 날짜가 포함되어 있습니다.',
  };
  const NOT_FOUND = {
    code: GrpcStatus.NOT_FOUND,
    message: '존재하지 않는 객실입니다.',
  };

  let roomRepository: { findOne: jest.Mock };
  let availabilityRepository: { find: jest.Mock };
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    increment: jest.Mock;
  };
  let transaction: jest.Mock;
  let cache: { getOrLoad: jest.Mock };
  let service: RoomService;

  // 사전 확인과 잠금 안에서 읽는 값을 따로 지정한다
  const given = (
    precheckRows: ReturnType<typeof day>[],
    lockedRows = precheckRows,
  ) => {
    availabilityRepository.find.mockResolvedValue(precheckRows);
    manager.find.mockResolvedValue(lockedRows);
  };

  const rpcErrorOf = async (promise: Promise<unknown>) => {
    const err: unknown = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RpcException);
    return (err as RpcException).getError();
  };

  const reserve = () =>
    service.reserveRoomAvailability(1, '2026-09-01', '2026-09-02');

  beforeEach(() => {
    roomRepository = { findOne: jest.fn().mockResolvedValue(room) };
    availabilityRepository = { find: jest.fn() };
    manager = {
      findOne: jest.fn().mockResolvedValue(room),
      find: jest.fn(),
      increment: jest.fn().mockResolvedValue(undefined),
    };
    transaction = jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
      work(manager),
    );
    cache = { getOrLoad: jest.fn() };
    service = new RoomService(
      roomRepository as unknown as Repository<RoomType>,
      {} as Repository<RoomUnit>,
      {} as Repository<Hotel>,
      availabilityRepository as unknown as Repository<RoomAvailability>,
      {} as Repository<RoomImage>,
      { transaction } as unknown as DataSource,
      {} as RoomImageStorage,
      cache as unknown as ReadCache,
    );
  });

  describe('잠금 트랜잭션에 들어가지 않고 거절', () => {
    it.each([
      ['매진된 날짜가 있음', [day('2026-09-01'), day('2026-09-02', 2)]],
      [
        '판매 중지된 날짜가 있음',
        [day('2026-09-01'), day('2026-09-02', 0, false)],
      ],
      ['날짜 행이 빠짐', [day('2026-09-01')]],
    ])('%s → 지금과 같은 오류', async (_, rows) => {
      given(rows);

      await expect(rpcErrorOf(reserve())).resolves.toEqual(SOLD_OUT);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('없는 객실 → NOT_FOUND', async () => {
      roomRepository.findOne.mockResolvedValue(null);
      given([]);

      await expect(rpcErrorOf(reserve())).resolves.toEqual(NOT_FOUND);
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  it('사전 확인은 잠금 없이, 트랜잭션 밖에서 읽는다', async () => {
    given([day('2026-09-01', 2), day('2026-09-02')]);

    await rpcErrorOf(reserve());

    expect(roomRepository.findOne).toHaveBeenCalledWith({
      where: { roomId: 1 },
    });
    expect(availabilityRepository.find).toHaveBeenCalledWith({
      where: { roomId: 1, date: Between('2026-09-01', '2026-09-02') },
    });
    expect(manager.find).not.toHaveBeenCalled();
  });

  it('보유 수량은 조회 캐시가 아니라 DB에서 읽는다 — 호실 추가 직후 잘못 거절하지 않음', async () => {
    roomRepository.findOne.mockResolvedValue({ roomId: 1, totalCount: 3 });
    manager.findOne.mockResolvedValue({ roomId: 1, totalCount: 3 });
    given([day('2026-09-01', 2), day('2026-09-02', 2)]);

    await expect(reserve()).resolves.toEqual({ totalAmount: 200000 });
    expect(cache.getOrLoad).not.toHaveBeenCalled();
  });

  it('방이 있으면 잠금 트랜잭션에서 잠그고 재고를 1 올린다', async () => {
    given([day('2026-09-01', 1), day('2026-09-02')]);

    await expect(reserve()).resolves.toEqual({ totalAmount: 200000 });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledWith(RoomType, {
      where: { roomId: 1 },
      lock: { mode: 'pessimistic_read' },
    });
    expect(manager.find).toHaveBeenCalledWith(RoomAvailability, {
      where: { roomId: 1, date: Between('2026-09-01', '2026-09-02') },
      order: { date: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.increment).toHaveBeenCalledWith(
      RoomAvailability,
      { roomId: 1, date: Between('2026-09-01', '2026-09-02') },
      'bookedCount',
      1,
    );
  });

  // 오버부킹 방지: 사전 확인을 통과해도 잠금 안의 값으로 다시 판정한다
  it.each([
    ['그사이 매진됨', [day('2026-09-01', 2), day('2026-09-02')]],
    ['그사이 판매 중지됨', [day('2026-09-01', 0, false), day('2026-09-02')]],
  ])(
    '사전 확인 통과 후 %s → 잠금 안에서 거절, 재고 그대로',
    async (_, lockedRows) => {
      given([day('2026-09-01', 1), day('2026-09-02')], lockedRows);

      await expect(rpcErrorOf(reserve())).resolves.toEqual(SOLD_OUT);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(manager.increment).not.toHaveBeenCalled();
    },
  );

  it('사전 확인 통과 후 호실이 줄어 매진 → 잠금 안의 보유 수량으로 거절', async () => {
    manager.findOne.mockResolvedValue({ roomId: 1, totalCount: 1 });
    given([day('2026-09-01', 1), day('2026-09-02')]);

    await expect(rpcErrorOf(reserve())).resolves.toEqual(SOLD_OUT);
    expect(manager.increment).not.toHaveBeenCalled();
  });
});
