import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AuthenticatedUser, apiRpcException } from '@app/common';
import { NoticeController } from './notice.controller';

// LDP-147: 공지사항 API — 조회는 공개, 작성·수정·삭제는 관리자 (직급은 가드가, 지점은 여기서 — LDP-188)
describe('NoticeController', () => {
  const notices = {
    listNotices: jest.fn(),
    getNotice: jest.fn(),
    createNotice: jest.fn(),
    updateNotice: jest.fn(),
    deleteNotice: jest.fn(),
  };
  const admin = {
    userId: 3,
    email: 'staff@hotel.com',
    role: 'ADMIN',
    type: 'ADMIN',
  } as AuthenticatedUser;
  // 서울(1) 지점 관리자 (LDP-188)
  const seoulManager = {
    ...admin,
    userId: 4,
    hotelId: 1,
    adminRole: 'MANAGER',
  } as AuthenticatedUser;
  const grpcNotice = {
    noticeId: 1,
    title: '머묾 온라인 예약 오픈',
    body: '본문',
    category: 'NOTICE',
    isPinned: false,
    createdByAdminId: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    hotelId: 0, // 전체 공지
  };
  const body = { title: '제목', body: '본문', category: 'EVENT' as const };
  let controller: NoticeController;

  const httpError = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    return {
      status: (error as HttpException).getStatus(),
      body: (error as HttpException).getResponse() as Record<string, unknown>,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    notices.getNotice.mockReturnValue(of(grpcNotice));
    notices.createNotice.mockReturnValue(
      of({ ...grpcNotice, createdByAdminId: 3 }),
    );
    notices.updateNotice.mockReturnValue(of(grpcNotice));
    notices.deleteNotice.mockReturnValue(of({ success: true }));
    controller = new NoticeController({
      getService: () => notices,
    } as never);
    controller.onModuleInit();
  });

  it('목록: 조건이 없으면 전체(page 0), 작성 직원이 없으면 null로 바꿔 응답', async () => {
    notices.listNotices.mockReturnValue(
      of({ notices: [grpcNotice], total: 6 }),
    );

    const result = await controller.listNotices({});

    expect(notices.listNotices).toHaveBeenCalledWith({
      page: 0,
      size: 20,
      hotelId: 0,
    });
    expect(result.total).toBe(6);
    expect(result.notices[0].createdByAdminId).toBeNull();
    expect(result.notices[0].hotelId).toBeNull(); // 전체 공지
  });

  it('목록: page·size를 넘기고, gRPC가 빈 목록을 생략해도 채워 준다', async () => {
    notices.listNotices.mockReturnValue(of({}));

    expect(await controller.listNotices({ page: 1, size: 3 })).toEqual({
      notices: [],
      total: 0,
    });
    expect(notices.listNotices).toHaveBeenCalledWith({
      page: 1,
      size: 3,
      hotelId: 0,
    });
  });

  it('목록: 지점 필터를 넘긴다 (그 지점 + 전체 공지)', async () => {
    notices.listNotices.mockReturnValue(of({}));

    await controller.listNotices({ hotelId: 2 });

    expect(notices.listNotices).toHaveBeenCalledWith({
      page: 0,
      size: 20,
      hotelId: 2,
    });
  });

  it('작성: 작성 직원은 토큰의 관리자, 고정을 생략하면 false', async () => {
    const result = await controller.createNotice(admin, body);

    expect(notices.createNotice).toHaveBeenCalledWith({
      ...body,
      isPinned: false,
      adminId: 3,
      hotelId: 0, // 본사가 지점을 생략하면 전체 공지
    });
    expect(result.createdByAdminId).toBe(3);
  });

  it('작성: 본사는 지점 공지도 쓸 수 있다', async () => {
    await controller.createNotice(admin, { ...body, hotelId: 3 });

    expect(notices.createNotice).toHaveBeenCalledWith(
      expect.objectContaining({ hotelId: 3 }),
    );
  });

  it('작성: 지점 관리자가 지점을 생략하면 자기 지점 공지', async () => {
    await controller.createNotice(seoulManager, body);

    expect(notices.createNotice).toHaveBeenCalledWith(
      expect.objectContaining({ hotelId: 1, adminId: 4 }),
    );
  });

  it('작성: 지점 관리자가 전체 공지·다른 지점을 고르면 403 ADMIN_HOTEL_FORBIDDEN', async () => {
    for (const hotelId of [null, 2]) {
      const { status, body: response } = await httpError(
        controller.createNotice(seoulManager, { ...body, hotelId }),
      );
      expect(status).toBe(403);
      expect(response).toMatchObject({ code: 'ADMIN_HOTEL_FORBIDDEN' });
    }
    expect(notices.createNotice).not.toHaveBeenCalled();
  });

  it('수정: 모든 칸을 함께 넘긴다', async () => {
    await controller.updateNotice(admin, 1, { ...body, isPinned: true });

    expect(notices.updateNotice).toHaveBeenCalledWith({
      noticeId: 1,
      ...body,
      isPinned: true,
      hotelId: 0,
    });
    expect(notices.getNotice).not.toHaveBeenCalled(); // 본사는 대상 지점 확인 없이
  });

  it('수정·삭제: 지점 관리자는 자기 지점 공지만', async () => {
    notices.getNotice.mockReturnValue(of({ ...grpcNotice, hotelId: 1 }));

    await controller.updateNotice(seoulManager, 1, body);
    await controller.deleteNotice(seoulManager, 1);

    expect(notices.updateNotice).toHaveBeenCalledWith(
      expect.objectContaining({ hotelId: 1 }),
    );
    expect(notices.deleteNotice).toHaveBeenCalledWith({ noticeId: 1 });
  });

  it('수정·삭제: 지점 관리자가 전체 공지·다른 지점 공지를 건드리면 403', async () => {
    for (const hotelId of [0, 2]) {
      notices.getNotice.mockReturnValue(of({ ...grpcNotice, hotelId }));

      for (const request of [
        controller.updateNotice(seoulManager, 1, body),
        controller.deleteNotice(seoulManager, 1),
      ]) {
        const { status, body: response } = await httpError(request);
        expect(status).toBe(403);
        expect(response).toMatchObject({ code: 'ADMIN_HOTEL_FORBIDDEN' });
      }
    }
    expect(notices.updateNotice).not.toHaveBeenCalled();
    expect(notices.deleteNotice).not.toHaveBeenCalled();
  });

  it('hotel-service의 404는 그대로 404 NOTICE_NOT_FOUND', async () => {
    notices.getNotice.mockReturnValue(
      throwError(() =>
        apiRpcException({
          status: 404,
          code: 'NOTICE_NOT_FOUND',
          message: '존재하지 않는 공지입니다.',
          retryable: false,
        }),
      ),
    );

    const { status, body: response } = await httpError(
      controller.getNotice(99),
    );

    expect(status).toBe(404);
    expect(response).toMatchObject({ code: 'NOTICE_NOT_FOUND' });
  });

  it('hotel-service 연결 실패는 503 HOTEL_SERVICE_UNAVAILABLE', async () => {
    notices.deleteNotice.mockReturnValue(
      throwError(() => ({ code: 14, details: 'No connection established' })),
    );

    const { status, body: response } = await httpError(
      controller.deleteNotice(admin, 1),
    );

    expect(status).toBe(503);
    expect(response).toMatchObject({ code: 'HOTEL_SERVICE_UNAVAILABLE' });
  });
});
