import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  OnModuleInit,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiCommonResponses } from '@app/common/decorators/api-response.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseApiRpcError,
  toHttpException,
} from '@app/common';
import { NoticeBodyDto, NoticeListQueryDto } from './dto/notice.dto';

// proto(hotel.proto)의 Notice 메시지 (gRPC에서는 "없음"이 0)
interface NoticeGrpc {
  noticeId: number;
  title: string;
  body: string;
  category: string;
  isPinned: boolean;
  createdByAdminId: number;
  createdAt: string;
  updatedAt: string;
}

// REST 응답 — 작성 직원이 없으면(seed 공지) null
export interface NoticeDto extends Omit<NoticeGrpc, 'createdByAdminId'> {
  createdByAdminId: number | null;
}

interface NoticeGrpcService {
  listNotices(data: {
    page: number;
    size: number;
  }): Observable<{ notices?: NoticeGrpc[]; total?: number }>;
  getNotice(data: { noticeId: number }): Observable<NoticeGrpc>;
  createNotice(data: {
    title: string;
    body: string;
    category: string;
    isPinned: boolean;
    adminId: number;
  }): Observable<NoticeGrpc>;
  updateNotice(data: {
    noticeId: number;
    title: string;
    body: string;
    category: string;
    isPinned: boolean;
  }): Observable<NoticeGrpc>;
  deleteNotice(data: { noticeId: number }): Observable<{ success: boolean }>;
}

const DEFAULT_PAGE_SIZE = 20;

function toNotice(notice: NoticeGrpc): NoticeDto {
  return {
    ...notice,
    isPinned: Boolean(notice.isPinned),
    createdByAdminId: notice.createdByAdminId || null,
  };
}

// hotel-service가 api-error 형식으로 던진 에러(404 NOTICE_NOT_FOUND 등)는 그대로, 그 밖(연결 실패 등)은 503
function toHttpError(err: unknown): Error {
  return toHttpException(
    parseApiRpcError(err) ?? {
      status: 503,
      code: 'HOTEL_SERVICE_UNAVAILABLE',
      message: '공지를 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      retryable: true,
    },
  );
}

// 공지사항 API (LDP-147). 조회는 로그인 없이, 작성·수정·삭제는 관리자만. 공지는 hotel-service가 소유한다.
@ApiTags('NoticeService')
@ApiCommonResponses()
@Controller('api/notices')
export class NoticeController implements OnModuleInit {
  private noticeService!: NoticeGrpcService;

  constructor(@Inject('HOTEL_SERVICE') private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.noticeService =
      this.client.getService<NoticeGrpcService>('NoticeService');
  }

  /**
   * GET /api/notices?page=1&size=3
   */
  @Get()
  @ApiOperation({
    summary: '공지 목록 (로그인 불필요)',
    description:
      '중요 고정 먼저, 그다음 최신순. page를 주면 그 페이지만, 생략하면 전체. total은 전체 공지 수.',
  })
  @ApiResponse({ status: 200, description: '{ notices, total }' })
  async listNotices(
    @Query() query: NoticeListQueryDto,
  ): Promise<{ notices: NoticeDto[]; total: number }> {
    try {
      const { notices = [], total = 0 } = await firstValueFrom(
        this.noticeService.listNotices({
          page: query.page ?? 0,
          size: query.size ?? DEFAULT_PAGE_SIZE,
        }),
      );
      return { notices: notices.map(toNotice), total };
    } catch (err) {
      throw toHttpError(err);
    }
  }

  /**
   * GET /api/notices/{noticeId}
   */
  @Get(':noticeId')
  @ApiParam({ name: 'noticeId', type: Number, example: 1 })
  @ApiOperation({ summary: '공지 상세 (로그인 불필요)' })
  @ApiResponse({ status: 200, description: 'Notice' })
  @ApiResponse({ status: 404, description: 'NOTICE_NOT_FOUND' })
  async getNotice(
    @Param('noticeId', ParseIntPipe) noticeId: number,
  ): Promise<NoticeDto> {
    try {
      return toNotice(
        await firstValueFrom(this.noticeService.getNotice({ noticeId })),
      );
    } catch (err) {
      throw toHttpError(err);
    }
  }

  /**
   * POST /api/notices
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '공지 작성 (관리자 전용)',
    description: '작성한 직원이 기록됩니다.',
  })
  @ApiResponse({ status: 201, description: 'Notice' })
  @ApiResponse({ status: 400, description: '제목·본문·분류 값이 잘못됨' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  async createNotice(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: NoticeBodyDto,
  ): Promise<NoticeDto> {
    try {
      return toNotice(
        await firstValueFrom(
          this.noticeService.createNotice({
            title: dto.title,
            body: dto.body,
            category: dto.category,
            isPinned: dto.isPinned ?? false,
            adminId: admin.userId,
          }),
        ),
      );
    } catch (err) {
      throw toHttpError(err);
    }
  }

  /**
   * PUT /api/notices/{noticeId}
   */
  @Put(':noticeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'noticeId', type: Number, example: 1 })
  @ApiOperation({
    summary: '공지 수정 (관리자 전용)',
    description:
      '제목·본문·분류·고정을 한 번에 바꿉니다 (작성일은 그대로). 고정을 생략하면 해제됩니다.',
  })
  @ApiResponse({ status: 200, description: 'Notice' })
  @ApiResponse({ status: 400, description: '제목·본문·분류 값이 잘못됨' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: 'NOTICE_NOT_FOUND' })
  async updateNotice(
    @Param('noticeId', ParseIntPipe) noticeId: number,
    @Body() dto: NoticeBodyDto,
  ): Promise<NoticeDto> {
    try {
      return toNotice(
        await firstValueFrom(
          this.noticeService.updateNotice({
            noticeId,
            title: dto.title,
            body: dto.body,
            category: dto.category,
            isPinned: dto.isPinned ?? false,
          }),
        ),
      );
    } catch (err) {
      throw toHttpError(err);
    }
  }

  /**
   * DELETE /api/notices/{noticeId}
   */
  @Delete(':noticeId')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'noticeId', type: Number, example: 1 })
  @ApiOperation({ summary: '공지 삭제 (관리자 전용)' })
  @ApiResponse({ status: 204, description: '삭제됨' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: 'NOTICE_NOT_FOUND' })
  async deleteNotice(
    @Param('noticeId', ParseIntPipe) noticeId: number,
  ): Promise<void> {
    try {
      await firstValueFrom(this.noticeService.deleteNotice({ noticeId }));
    } catch (err) {
      throw toHttpError(err);
    }
  }
}
