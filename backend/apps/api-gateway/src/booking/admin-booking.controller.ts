import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  OnModuleInit,
  Param,
  ParseIntPipe,
  Post,
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
import { BookingDto, toBooking } from './booking.controller';
import {
  AdminBookingListQueryDto,
  AdminCancelBookingDto,
  AdminCreateBookingDto,
  CreateExtensionBookingDto,
} from './dto/admin-booking.dto';

// 페이지 크기 기본값 (LDP-136)
const DEFAULT_PAGE_SIZE = 20;
// 검색어로 찾을 회원 수 상한 — 이보다 많이 걸리는 짧은 검색어는 앞쪽(최근 가입) 회원의 예약만 찾는다
const KEYWORD_USER_LIMIT = 500;
// proto int32 최댓값 — 더 큰 숫자는 예약번호일 수 없다
const MAX_INT32 = 2147483647;

// proto(booking.proto)의 관리자 예약 RPC (LDP-90), 예약 목록 (LDP-136)
interface AdminBookingGrpcService {
  getBookings(data: {
    page: number;
    size: number;
    hotelId: number;
    statuses: string[];
    hasKeyword: boolean;
    keywordReservationId: number;
    keywordUserIds: number[];
    linkedTo: number;
    keywordRoomUnitIds: number[];
  }): Observable<{ bookings?: BookingDto[]; total?: number }>;
  createAdminBooking(data: {
    userId: number;
    roomId: number;
    hotelId: number;
    checkInDate: string;
    checkOutDate: string;
    guestCount: number;
    poolGuestCount?: number;
    loungeGuestCount?: number;
    adminId: number;
    adminName: string;
  }): Observable<BookingDto>;
  adminCancelBooking(data: {
    reservationId: number;
    adminId: number;
    cancelReason: string;
  }): Observable<BookingDto>;
  createExtensionBooking(data: {
    reservationId: number;
    checkOutDate: string;
    keepSameRoomUnit: boolean;
    adminId: number;
    adminName: string;
  }): Observable<BookingDto>;
}

// proto(user.proto)의 UserService / GetUserById, GetUsers(회원 검색, LDP-136)
interface UserLookupGrpcService {
  getUserById(data: { id: number }): Observable<{ id: number; name: string }>;
  getUsers(data: {
    page: number;
    size: number;
    keyword: string;
  }): Observable<{ users?: { id: number }[] }>;
}

// proto(hotel.proto)의 HotelService / GetHotels, ListRoomUnits — 방 번호 검색 (LDP-136)
interface RoomLookupGrpcService {
  getHotels(data: object): Observable<{ hotels?: { hotelId: number }[] }>;
  listRoomUnits(data: {
    hotelId: number;
    roomId: number;
    status: string;
  }): Observable<{ units?: { roomUnitId: number; roomNumber: string }[] }>;
}

// proto(user.proto)의 AdminService / GetAdminById — 회원(UserService)과 다른 서비스다
interface AdminLookupGrpcService {
  getAdminById(data: { id: number }): Observable<{ id: number; name: string }>;
}

// booking-service가 api-error 형식으로 던진 에러는 그대로 옮기고, 그 밖의 에러(연결 실패 등)는 503
function toHttpError(err: unknown, code: string, message: string): Error {
  const payload = parseApiRpcError(err);
  return toHttpException(
    payload ?? { status: 503, code, message, retryable: true },
  );
}

// 관리자 예약 API — 대리 예약·직원 취소·투숙 연장 (LDP-90). 모두 관리자 전용.
// 회원 존재 확인과 직원 이름 조회는 user-service에서 해서 booking-service에 넘긴다 (booking은 회원 DB를 모름).
@ApiTags('BookingService')
@ApiCommonResponses()
@Controller('api/bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class AdminBookingController implements OnModuleInit {
  private bookingService!: AdminBookingGrpcService;
  private userService!: UserLookupGrpcService;
  private adminService!: AdminLookupGrpcService;
  private hotelService!: RoomLookupGrpcService;

  constructor(
    @Inject('BOOKING_SERVICE') private readonly bookingClient: ClientGrpc,
    @Inject('USER_SERVICE') private readonly userClient: ClientGrpc,
    @Inject('HOTEL_SERVICE') private readonly hotelClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.bookingService =
      this.bookingClient.getService<AdminBookingGrpcService>('BookingService');
    this.userService =
      this.userClient.getService<UserLookupGrpcService>('UserService');
    this.adminService =
      this.userClient.getService<AdminLookupGrpcService>('AdminService');
    this.hotelService =
      this.hotelClient.getService<RoomLookupGrpcService>('HotelService');
  }

  /**
   * GET /api/bookings
   * 관리자 예약 목록 — 조건·페이지 (LDP-136). 아무 조건도 없으면 예전처럼 전체 목록.
   * 회원 이름·이메일은 booking DB에 없으므로, 검색어로 user-service에서 회원을 먼저 찾아 그 회원들의 예약을 고른다.
   */
  @Get()
  @ApiOperation({
    summary: '예약 목록 조회 (관리자 전용)',
    description:
      '최신순. page를 주면 그 페이지만, 생략하면 조건에 맞는 전체를 돌려줍니다. total은 조건에 맞는 전체 개수입니다. ' +
      'keyword는 예약번호(숫자)·회원 이름·이메일·연락처·방 번호 일부로 찾고, linkedTo는 그 예약과 연장 예약만 돌려줍니다.',
  })
  @ApiResponse({ status: 200, description: '{ bookings, total }' })
  @ApiResponse({ status: 400, description: '조건 값이 잘못됨' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({
    status: 503,
    description:
      'USER_SERVICE_UNAVAILABLE / HOTEL_SERVICE_UNAVAILABLE / BOOKING_SERVICE_UNAVAILABLE',
  })
  async getBookings(
    @Query() query: AdminBookingListQueryDto,
  ): Promise<{ bookings: BookingDto[]; total: number }> {
    const keyword = query.keyword?.trim() ?? '';
    let keywordReservationId = 0;
    let keywordUserIds: number[] = [];
    let keywordRoomUnitIds: number[] = [];
    if (keyword) {
      if (/^\d+$/.test(keyword) && Number(keyword) <= MAX_INT32) {
        keywordReservationId = Number(keyword);
      }
      try {
        const { users = [] } = await firstValueFrom(
          this.userService.getUsers({
            page: 1,
            size: KEYWORD_USER_LIMIT,
            keyword,
          }),
        );
        keywordUserIds = users.map((user) => user.id);
      } catch (err) {
        throw toHttpError(
          err,
          'USER_SERVICE_UNAVAILABLE',
          '회원 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
      try {
        keywordRoomUnitIds = await this.findRoomUnitIds(keyword, query.hotelId);
      } catch (err) {
        throw toHttpError(
          err,
          'HOTEL_SERVICE_UNAVAILABLE',
          '호실 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
    }

    try {
      const { bookings = [], total = 0 } = await firstValueFrom(
        this.bookingService.getBookings({
          page: query.page ?? 0,
          size: query.size ?? DEFAULT_PAGE_SIZE,
          hotelId: query.hotelId ?? 0,
          statuses: query.status ?? [],
          hasKeyword: keyword !== '',
          keywordReservationId,
          keywordUserIds,
          linkedTo: query.linkedTo ?? 0,
          keywordRoomUnitIds,
        }),
      );
      return { bookings: bookings.map(toBooking), total };
    } catch (err) {
      throw toHttpError(
        err,
        'BOOKING_SERVICE_UNAVAILABLE',
        '예약 목록을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
  }

  // 방 번호에 검색어가 들어 있는 호실 ID (LDP-136). 방 번호는 hotel-service에 있어 지점별 호실 목록에서 찾는다 —
  // 지점 조건이 없으면 모든 지점을 본다 (지점 수·호실 수가 적어 목록을 받아 거르는 편이 간단하다).
  private async findRoomUnitIds(
    keyword: string,
    hotelId?: number,
  ): Promise<number[]> {
    const hotelIds = hotelId
      ? [hotelId]
      : (
          (await firstValueFrom(this.hotelService.getHotels({}))).hotels ?? []
        ).map((hotel) => hotel.hotelId);
    const lists = await Promise.all(
      hotelIds.map((id) =>
        firstValueFrom(
          this.hotelService.listRoomUnits({
            hotelId: id,
            roomId: 0,
            status: '',
          }),
        ),
      ),
    );
    const lowered = keyword.toLowerCase();
    return lists
      .flatMap(({ units = [] }) => units)
      .filter((unit) => unit.roomNumber.toLowerCase().includes(lowered))
      .map((unit) => unit.roomUnitId);
  }

  /**
   * POST /api/bookings/admin
   */
  @Post('admin')
  @ApiOperation({
    summary: '대리 예약 생성 (관리자 전용)',
    description:
      '직원이 회원 명의로 예약을 만듭니다. 결제는 손님이 앱에서 하며(손님 앱 "결제 대기"에 보임), ' +
      '결제 마감은 생성한 날 밤 자정(한국 시간, 최소 30분)입니다. 만든 직원이 예약에 기록됩니다.',
  })
  @ApiResponse({ status: 201, description: '대리 예약 생성 성공' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'ROOM_NOT_AVAILABLE / FACILITY_NOT_AVAILABLE',
  })
  async createAdminBooking(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: AdminCreateBookingDto,
  ): Promise<BookingDto> {
    await this.assertUserExists(dto.userId);
    const adminName = await this.adminName(admin);
    const booking = await firstValueFrom(
      this.bookingService.createAdminBooking({
        ...dto,
        adminId: admin.userId,
        adminName,
      }),
    ).catch((err) => {
      throw toHttpError(
        err,
        'BOOKING_SERVICE_UNAVAILABLE',
        '예약을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      );
    });
    return toBooking(booking);
  }

  /**
   * POST /api/bookings/{reservationId}/admin-cancel
   */
  @Post(':reservationId/admin-cancel')
  @HttpCode(200)
  @ApiParam({ name: 'reservationId', type: Number, example: 12 })
  @ApiOperation({
    summary: '직원 취소 (관리자 전용)',
    description:
      '결제 대기·예약 확정 예약을 취소합니다. 재고를 돌려놓고, 결제됐으면 전액 환불합니다. ' +
      '취소한 직원과 사유가 기록되고, 원래 예약이면 연결된 연장 예약도 같은 사유로 함께 취소됩니다.',
  })
  @ApiResponse({ status: 200, description: '취소된 예약 (status: CANCELLED)' })
  @ApiResponse({ status: 404, description: 'RESERVATION_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'INVALID_RESERVATION_STATUS' })
  async adminCancelBooking(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Body() dto: AdminCancelBookingDto,
  ): Promise<BookingDto> {
    const booking = await firstValueFrom(
      this.bookingService.adminCancelBooking({
        reservationId,
        adminId: admin.userId,
        cancelReason: dto.cancelReason.trim(),
      }),
    ).catch((err) => {
      throw toHttpError(
        err,
        'BOOKING_SERVICE_UNAVAILABLE',
        '예약 취소를 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      );
    });
    return toBooking(booking);
  }

  /**
   * POST /api/bookings/{reservationId}/extensions
   */
  @Post(':reservationId/extensions')
  @ApiParam({
    name: 'reservationId',
    description: '연장할 예약 (연장의 연장이면 가장 최근 연장 예약)',
    type: Number,
    example: 12,
  })
  @ApiOperation({
    summary: '투숙 연장 예약 생성 (관리자 전용)',
    description:
      '예약 확정된 예약의 체크아웃부터 새 예약을 이어 붙입니다 (같은 회원·객실 종류·인원). ' +
      '새 예약은 원래 예약에 연결되고(linkedReservationId), 결제는 손님이 앱에서 합니다 (마감 = 생성한 날 자정, 최소 30분). ' +
      'keepSameRoomUnit이면 같은 호실이 비어 있을 때 같은 호실로 배정합니다.',
  })
  @ApiResponse({ status: 201, description: '연장 예약 생성 성공' })
  @ApiResponse({ status: 400, description: 'INVALID_EXTENSION_DATES' })
  @ApiResponse({ status: 404, description: 'RESERVATION_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'INVALID_RESERVATION_STATUS / ROOM_NOT_AVAILABLE',
  })
  async createExtensionBooking(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Body() dto: CreateExtensionBookingDto,
  ): Promise<BookingDto> {
    const adminName = await this.adminName(admin);
    const booking = await firstValueFrom(
      this.bookingService.createExtensionBooking({
        reservationId,
        checkOutDate: dto.checkOutDate,
        keepSameRoomUnit: dto.keepSameRoomUnit ?? true,
        adminId: admin.userId,
        adminName,
      }),
    ).catch((err) => {
      throw toHttpError(
        err,
        'BOOKING_SERVICE_UNAVAILABLE',
        '연장 예약을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      );
    });
    return toBooking(booking);
  }

  // 예약할 회원이 있는지 확인. user-service는 없는 회원이면 "존재하지 않는 유저입니다." RpcException을 던진다.
  private async assertUserExists(userId: number): Promise<void> {
    await firstValueFrom(this.userService.getUserById({ id: userId })).catch(
      (err: { details?: string }) => {
        if (err?.details?.includes('존재하지 않는')) {
          throw toHttpException({
            status: 404,
            code: 'USER_NOT_FOUND',
            message: '존재하지 않는 회원입니다.',
            retryable: false,
          });
        }
        throw toHttpException({
          status: 503,
          code: 'USER_SERVICE_UNAVAILABLE',
          message:
            '회원 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
          retryable: true,
        });
      },
    );
  }

  // 예약에 남길 직원 이름. 조회에 실패해도 예약은 만들 수 있도록 토큰의 이메일로 대신한다.
  private async adminName(admin: AuthenticatedUser): Promise<string> {
    const found = await firstValueFrom(
      this.adminService.getAdminById({ id: admin.userId }),
    ).catch(() => null);
    return found?.name || admin.email;
  }
}
