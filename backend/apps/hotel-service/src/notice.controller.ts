import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { NoticeInput, NoticeService } from './notice.service';

// proto(hotel.proto)의 NoticeService와 매핑 (LDP-147). 권한 검사(관리자 전용 작성·수정·삭제)는 api-gateway가 한다.
@Controller()
export class NoticeController {
  constructor(private readonly noticeService: NoticeService) {}

  @GrpcMethod('NoticeService', 'ListNotices')
  async listNotices(data: { page: number; size: number }) {
    return this.noticeService.listNotices(data.page ?? 0, data.size ?? 0);
  }

  @GrpcMethod('NoticeService', 'GetNotice')
  async getNotice(data: { noticeId: number }) {
    return this.noticeService.getNotice(data.noticeId);
  }

  @GrpcMethod('NoticeService', 'CreateNotice')
  async createNotice(data: NoticeInput & { adminId: number }) {
    return this.noticeService.createNotice(data);
  }

  @GrpcMethod('NoticeService', 'UpdateNotice')
  async updateNotice(data: NoticeInput & { noticeId: number }) {
    return this.noticeService.updateNotice(data.noticeId, data);
  }

  @GrpcMethod('NoticeService', 'DeleteNotice')
  async deleteNotice(data: { noticeId: number }) {
    return this.noticeService.deleteNotice(data.noticeId);
  }
}
