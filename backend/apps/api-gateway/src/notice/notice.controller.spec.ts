import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AuthenticatedUser, apiRpcException } from '@app/common';
import { NoticeController } from './notice.controller';

// LDP-147: 공지사항 API — 조회는 공개, 작성·수정·삭제는 관리자 (권한은 가드가, 여기서는 변환·전달만)
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
  const grpcNotice = {
    noticeId: 1,
    title: '머묾 온라인 예약 오픈',
    body: '본문',
    category: 'NOTICE',
    isPinned: false,
    createdByAdminId: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
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

    expect(notices.listNotices).toHaveBeenCalledWith({ page: 0, size: 20 });
    expect(result.total).toBe(6);
    expect(result.notices[0].createdByAdminId).toBeNull();
  });

  it('목록: page·size를 넘기고, gRPC가 빈 목록을 생략해도 채워 준다', async () => {
    notices.listNotices.mockReturnValue(of({}));

    expect(await controller.listNotices({ page: 1, size: 3 })).toEqual({
      notices: [],
      total: 0,
    });
    expect(notices.listNotices).toHaveBeenCalledWith({ page: 1, size: 3 });
  });

  it('작성: 작성 직원은 토큰의 관리자, 고정을 생략하면 false', async () => {
    const result = await controller.createNotice(admin, body);

    expect(notices.createNotice).toHaveBeenCalledWith({
      ...body,
      isPinned: false,
      adminId: 3,
    });
    expect(result.createdByAdminId).toBe(3);
  });

  it('수정: 모든 칸을 함께 넘긴다', async () => {
    await controller.updateNotice(1, { ...body, isPinned: true });

    expect(notices.updateNotice).toHaveBeenCalledWith({
      noticeId: 1,
      ...body,
      isPinned: true,
    });
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
      controller.deleteNotice(1),
    );

    expect(status).toBe(503);
    expect(response).toMatchObject({ code: 'HOTEL_SERVICE_UNAVAILABLE' });
  });
});
