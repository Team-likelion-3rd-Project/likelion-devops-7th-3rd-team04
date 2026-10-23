import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { apiRpcException } from '@app/common';
import { Notice, NoticeCategory } from './entities/notice.entity';

// proto(hotel.proto)의 Notice 메시지와 1:1 대응
export interface NoticeGrpcResponse {
  noticeId: number;
  title: string;
  body: string;
  category: string;
  isPinned: boolean;
  createdByAdminId: number; // 없으면 0 (seed 공지)
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface NoticeInput {
  title: string;
  body: string;
  category: string;
  isPinned: boolean;
}

const NOTICE_CATEGORIES = Object.values(NoticeCategory) as string[];

function noticeNotFound(): Error {
  return apiRpcException({
    status: 404,
    code: 'NOTICE_NOT_FOUND',
    message: '존재하지 않는 공지입니다.',
    retryable: false,
  });
}

// 공지사항 (LDP-147). 고객 공지 페이지·메인 "새로운 소식"이 목록을, 관리자 "공지 관리"가 작성·수정·삭제를 쓴다.
// 입력 검사(길이·필수)는 api-gateway DTO가 하고, 여기서는 분류 값만 한 번 더 막는다(gRPC로 직접 불려도 DB 오류가 나지 않게).
@Injectable()
export class NoticeService {
  constructor(
    @InjectRepository(Notice)
    private readonly noticeRepository: Repository<Notice>,
  ) {}

  // 목록: 중요 고정 먼저, 그다음 최신순. page가 0이면 전체, 1 이상이면 그 페이지만. total은 전체 개수.
  async listNotices(
    page: number,
    size: number,
  ): Promise<{ notices: NoticeGrpcResponse[]; total: number }> {
    const take = size > 0 ? size : 20;
    const [notices, total] = await this.noticeRepository.findAndCount({
      order: { isPinned: 'DESC', createdAt: 'DESC', noticeId: 'DESC' },
      ...(page > 0 ? { skip: (page - 1) * take, take } : {}),
    });
    return { notices: notices.map((notice) => this.toGrpc(notice)), total };
  }

  async getNotice(noticeId: number): Promise<NoticeGrpcResponse> {
    const notice = await this.noticeRepository.findOne({ where: { noticeId } });
    if (!notice) {
      throw noticeNotFound();
    }
    return this.toGrpc(notice);
  }

  async createNotice(
    input: NoticeInput & { adminId: number },
  ): Promise<NoticeGrpcResponse> {
    const notice = await this.noticeRepository.save(
      this.noticeRepository.create({
        ...this.toColumns(input),
        createdByAdminId: input.adminId || null,
      }),
    );
    return this.toGrpc(notice);
  }

  // 제목·본문·분류·고정을 한 번에 바꾼다 (작성 직원·작성 시각은 그대로)
  async updateNotice(
    noticeId: number,
    input: NoticeInput,
  ): Promise<NoticeGrpcResponse> {
    const notice = await this.noticeRepository.findOne({ where: { noticeId } });
    if (!notice) {
      throw noticeNotFound();
    }
    Object.assign(notice, this.toColumns(input));
    return this.toGrpc(await this.noticeRepository.save(notice));
  }

  // 실제로 지운다 (공지는 이력을 남길 필요가 없어 백업하지 않음)
  async deleteNotice(noticeId: number): Promise<{ success: boolean }> {
    const { affected } = await this.noticeRepository.delete({ noticeId });
    if (!affected) {
      throw noticeNotFound();
    }
    return { success: true };
  }

  private toColumns(input: NoticeInput) {
    if (!NOTICE_CATEGORIES.includes(input.category)) {
      throw apiRpcException({
        status: 400,
        code: 'INVALID_NOTICE_CATEGORY',
        message: '공지 분류는 NOTICE, EVENT, MAINTENANCE 중 하나입니다.',
        retryable: false,
      });
    }
    return {
      title: input.title,
      body: input.body,
      category: input.category as NoticeCategory,
      isPinned: Boolean(input.isPinned),
    };
  }

  private toGrpc(notice: Notice): NoticeGrpcResponse {
    return {
      noticeId: notice.noticeId,
      title: notice.title,
      body: notice.body,
      category: notice.category,
      // MariaDB TINYINT(1)은 1/0으로 읽힐 수 있다
      isPinned: Boolean(notice.isPinned),
      createdByAdminId: notice.createdByAdminId ?? 0,
      createdAt: notice.createdAt.toISOString(),
      updatedAt: notice.updatedAt.toISOString(),
    };
  }
}
