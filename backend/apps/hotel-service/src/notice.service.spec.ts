import { IsNull, Repository } from 'typeorm';
import { parseApiRpcError } from '@app/common';
import { Hotel } from './entities/hotel.entity';
import { Notice, NoticeCategory } from './entities/notice.entity';
import { NoticeService } from './notice.service';

// LDP-147: 공지사항
describe('NoticeService', () => {
  const repository = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((data: Partial<Notice>) => data),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const hotelRepository = { exists: jest.fn() };
  const service = new NoticeService(
    repository as unknown as Repository<Notice>,
    hotelRepository as unknown as Repository<Hotel>,
  );
  const saved: Notice = {
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
  const input = {
    title: '점검 안내',
    body: '02:00~04:00 점검',
    category: 'MAINTENANCE',
    isPinned: true,
  };
  const codeOf = async (promise: Promise<unknown>) =>
    parseApiRpcError(await promise.catch((e: unknown) => e));

  beforeEach(() => {
    jest.clearAllMocks();
    hotelRepository.exists.mockResolvedValue(true);
  });

  describe('listNotices', () => {
    it('고정 먼저·최신순, page 0이면 전체 — total은 전체 개수', async () => {
      repository.findAndCount.mockResolvedValue([[saved], 1]);

      const result = await service.listNotices(0, 20);

      expect(repository.findAndCount).toHaveBeenCalledWith({
        order: { isPinned: 'DESC', createdAt: 'DESC', noticeId: 'DESC' },
      });
      expect(result).toEqual({
        notices: [
          {
            noticeId: 7,
            title: '점검 안내',
            body: '02:00~04:00 점검',
            category: 'MAINTENANCE',
            isPinned: true,
            createdByAdminId: 0, // seed 공지는 작성 직원 없음
            createdAt: '2026-10-10T00:00:00.000Z',
            updatedAt: '2026-10-11T00:00:00.000Z',
            hotelId: 0, // 전체 공지
          },
        ],
        total: 1,
      });
    });

    it('page·size면 그 페이지만 (메인 "새로운 소식" = 1페이지 3개)', async () => {
      repository.findAndCount.mockResolvedValue([[], 6]);

      await service.listNotices(2, 3);

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 3, take: 3 }),
      );
    });

    it('지점 필터면 그 지점 공지 + 전체 공지(hotel_id NULL)만 (LDP-188)', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.listNotices(0, 20, 2);

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [{ hotelId: 2 }, { hotelId: IsNull() }],
        }),
      );
    });
  });

  it('없는 공지 조회·수정·삭제는 404 NOTICE_NOT_FOUND', async () => {
    repository.findOne.mockResolvedValue(null);
    repository.delete.mockResolvedValue({ affected: 0 });

    expect((await codeOf(service.getNotice(99)))?.code).toBe(
      'NOTICE_NOT_FOUND',
    );
    expect((await codeOf(service.updateNotice(99, input)))?.status).toBe(404);
    expect((await codeOf(service.deleteNotice(99)))?.status).toBe(404);
  });

  it('작성: 작성 직원을 기록한다', async () => {
    repository.save.mockResolvedValue({ ...saved, createdByAdminId: 3 });

    const result = await service.createNotice({ ...input, adminId: 3 });

    expect(repository.create).toHaveBeenCalledWith({
      title: '점검 안내',
      body: '02:00~04:00 점검',
      category: NoticeCategory.MAINTENANCE,
      isPinned: true,
      hotelId: null, // 지점을 안 주면 전체 공지
      createdByAdminId: 3,
    });
    expect(result.createdByAdminId).toBe(3);
  });

  it('작성: 지점 공지는 대상 지점을 저장하고, 없는 호텔이면 404 HOTEL_NOT_FOUND (LDP-188)', async () => {
    repository.save.mockResolvedValue({ ...saved, hotelId: 2 });

    const result = await service.createNotice({
      ...input,
      adminId: 3,
      hotelId: 2,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ hotelId: 2 }),
    );
    expect(result.hotelId).toBe(2);

    hotelRepository.exists.mockResolvedValue(false);
    repository.save.mockClear();
    expect(
      await codeOf(service.createNotice({ ...input, adminId: 3, hotelId: 99 })),
    ).toMatchObject({ status: 404, code: 'HOTEL_NOT_FOUND' });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('수정: 제목·본문·분류·고정만 바꾸고 작성 직원·작성일은 그대로', async () => {
    repository.findOne.mockResolvedValue({ ...saved, createdByAdminId: 3 });
    repository.save.mockImplementation((notice: Notice) =>
      Promise.resolve(notice),
    );

    const result = await service.updateNotice(7, {
      title: '새 제목',
      body: '새 본문',
      category: 'EVENT',
      isPinned: false,
    });

    expect(result).toMatchObject({
      title: '새 제목',
      category: 'EVENT',
      isPinned: false,
      createdByAdminId: 3,
      createdAt: '2026-10-10T00:00:00.000Z',
    });
  });

  it('분류가 3종이 아니면 400 INVALID_NOTICE_CATEGORY (DB에 저장하지 않음)', async () => {
    const error = await codeOf(
      service.createNotice({ ...input, category: 'ETC', adminId: 3 }),
    );

    expect(error).toMatchObject({
      status: 400,
      code: 'INVALID_NOTICE_CATEGORY',
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('DB의 TINYINT 1/0도 true/false로 내려준다', async () => {
    repository.findOne.mockResolvedValue({ ...saved, isPinned: 1 });

    expect((await service.getNotice(7)).isPinned).toBe(true);
  });
});
