import type Redis from 'ioredis';
import { DataSource, Repository } from 'typeorm';
import { ReadCache } from '@app/common';
import { RoomService } from './room.service';
import { NoticeService } from './notice.service';
import { RoomImageStorage } from './room-image.storage';
import { Hotel } from './entities/hotel.entity';
import { RoomType } from './entities/room-type.entity';
import { RoomUnit } from './entities/room-unit.entity';
import { RoomAvailability } from './entities/room-availability.entity';
import { RoomImage } from './entities/room-image.entity';
import { Notice, NoticeCategory } from './entities/notice.entity';

// 조회 캐시(Valkey)를 켠 상태의 hotel-service — Valkey는 Map으로 흉내 낸다
function fakeRedisCache(): ReadCache {
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string, mode?: string) => {
      if (mode === 'NX' && store.has(key)) {
        return Promise.resolve(null);
      }
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((...keys: string[]) =>
      Promise.resolve(keys.filter((key) => store.delete(key)).length),
    ),
    incr: jest.fn((key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return Promise.resolve(next);
    }),
  };
  return new ReadCache(redis as unknown as Redis, 'test:', 300);
}

// getOrLoad는 저장을 기다리지 않으므로, 다음 조회 전에 저장이 끝나게 한 번 양보한다
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('RoomService 조회 캐시', () => {
  const room = {
    roomId: 1,
    hotelId: 1,
    name: '디럭스 더블룸',
    capacity: 2,
    totalCount: 3,
    description: '시티뷰',
  };
  const image = {
    imageId: 10,
    roomId: 1,
    mimeType: 'image/jpeg',
    objectKey: 'room-types/1/a.jpg',
    sortOrder: 0,
  };

  let hotelRepository: { findOne: jest.Mock };
  let roomRepository: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock };
  let roomImageRepository: {
    find: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
  };
  let service: RoomService;

  beforeEach(() => {
    hotelRepository = { findOne: jest.fn().mockResolvedValue({ hotelId: 1 }) };
    roomRepository = {
      find: jest.fn().mockResolvedValue([room]),
      findOne: jest.fn().mockResolvedValue({ ...room }),
      save: jest.fn((r: RoomType) => Promise.resolve(r)),
    };
    roomImageRepository = {
      find: jest.fn().mockResolvedValue([image]),
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue([]),
    };
    // 호출할 때마다 새로 만든 URL (Presigned URL이면 서명·만료 시각이 매번 다르다)
    let signed = 0;
    const createViewUrl = jest.fn((key: string) =>
      Promise.resolve(`https://storage.test/${key}?sig=${++signed}`),
    );

    service = new RoomService(
      roomRepository as unknown as Repository<RoomType>,
      {} as Repository<RoomUnit>,
      hotelRepository as unknown as Repository<Hotel>,
      {} as Repository<RoomAvailability>,
      roomImageRepository as unknown as Repository<RoomImage>,
      {} as DataSource,
      {
        createViewUrl,
        getUploadedImageType: jest.fn(),
        deleteObjects: jest.fn().mockResolvedValue(undefined),
      } as unknown as RoomImageStorage,
      fakeRedisCache(),
    );
  });

  it('객실 목록은 두 번째부터 DB를 읽지 않는다', async () => {
    await service.getRoomsByHotel(1);
    await flush();
    await service.getRoomsByHotel(1);

    expect(hotelRepository.findOne).toHaveBeenCalledTimes(1);
    expect(roomRepository.find).toHaveBeenCalledTimes(1);
    expect(roomImageRepository.find).toHaveBeenCalledTimes(1);
  });

  it('객실 단건도 두 번째부터 DB를 읽지 않는다', async () => {
    await service.getRoomById(1, 1);
    await flush();
    const result = await service.getRoomById(1, 1);

    expect(result).toMatchObject({ roomId: 1, totalCount: 3 });
    expect(roomRepository.findOne).toHaveBeenCalledTimes(1);
  });

  it('사진 URL은 캐시에서 읽어도 매번 새로 만든다 (캐시에는 objectKey만)', async () => {
    const first = await service.getRoomsByHotel(1);
    await flush();
    const second = await service.getRoomsByHotel(1);

    expect(first[0].images[0].imageUrl).toBe(
      'https://storage.test/room-types/1/a.jpg?sig=1',
    );
    expect(second[0].images[0].imageUrl).toBe(
      'https://storage.test/room-types/1/a.jpg?sig=2',
    );
    expect(second[0].images[0].objectKey).toBe('room-types/1/a.jpg');
  });

  it('객실을 수정하면 목록·단건 캐시를 지워 다음 조회는 DB에서 읽는다', async () => {
    await service.getRoomsByHotel(1);
    await service.getRoomById(1, 1);
    await flush();

    await service.updateRoom(1, 1, { name: '새 이름', capacity: 2 });
    roomRepository.find.mockResolvedValue([{ ...room, name: '새 이름' }]);
    roomRepository.findOne.mockResolvedValue({ ...room, name: '새 이름' });

    expect((await service.getRoomsByHotel(1))[0].name).toBe('새 이름');
    expect((await service.getRoomById(1, 1)).name).toBe('새 이름');
    expect(roomRepository.find).toHaveBeenCalledTimes(2);
  });

  it('없는 호텔은 캐시에 남기지 않는다', async () => {
    hotelRepository.findOne.mockResolvedValue(null);

    await expect(service.getRoomsByHotel(9)).rejects.toThrow();
    await flush();
    await expect(service.getRoomsByHotel(9)).rejects.toThrow();

    expect(hotelRepository.findOne).toHaveBeenCalledTimes(2);
  });
});

describe('NoticeService 조회 캐시', () => {
  const notice: Notice = {
    noticeId: 7,
    title: '점검 안내',
    body: '02:00~04:00 점검',
    category: NoticeCategory.MAINTENANCE,
    isPinned: true,
    createdByAdminId: null,
    hotelId: null,
    createdAt: new Date('2026-10-10T00:00:00Z'),
    updatedAt: new Date('2026-10-11T00:00:00Z'),
  };
  let repository: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let service: NoticeService;

  beforeEach(() => {
    repository = {
      findAndCount: jest.fn().mockResolvedValue([[notice], 1]),
      findOne: jest.fn().mockResolvedValue({ ...notice }),
      save: jest.fn((n: Notice) => Promise.resolve(n)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new NoticeService(
      repository as unknown as Repository<Notice>,
      { exists: jest.fn() } as unknown as Repository<Hotel>,
      fakeRedisCache(),
    );
  });

  it('목록은 캐시에서 읽고, 공지를 수정하면 모든 목록 키가 다시 DB에서 읽힌다', async () => {
    await service.listNotices(1, 3);
    await service.listNotices(1, 20, 1);
    await flush();
    await service.listNotices(1, 3);
    await service.listNotices(1, 20, 1);
    expect(repository.findAndCount).toHaveBeenCalledTimes(2);

    await service.updateNotice(7, {
      title: '변경',
      body: '본문',
      category: 'NOTICE',
      isPinned: false,
    });
    await service.listNotices(1, 3);
    await service.listNotices(1, 20, 1);

    expect(repository.findAndCount).toHaveBeenCalledTimes(4);
  });

  it('캐시에서 읽은 공지도 날짜는 ISO 문자열 그대로다', async () => {
    await service.getNotice(7);
    await flush();
    const cached = await service.getNotice(7);

    expect(repository.findOne).toHaveBeenCalledTimes(1);
    expect(cached.createdAt).toBe('2026-10-10T00:00:00.000Z');
  });

  it('공지를 지우면 단건 캐시도 지운다', async () => {
    await service.getNotice(7);
    await flush();

    await service.deleteNotice(7);
    repository.findOne.mockResolvedValue(null);

    await expect(service.getNotice(7)).rejects.toThrow();
  });
});
