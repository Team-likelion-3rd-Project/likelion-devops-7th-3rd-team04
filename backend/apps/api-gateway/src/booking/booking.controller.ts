import {
  ConflictException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseIntPipe,
  Put,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ApiCommonResponses } from '@app/common/decorators/api-response.decorator';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  parseApiRpcError,
  toHttpException,
} from '@app/common';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { AssignRoomUnitDto } from './dto/assign-room-unit.dto';

// proto의 Booking 메시지와 1:1 대응되는 응답 형태. 편의시설(수영장/라운지) 이용 여부/인원수는
// 여기 담기지 않는다 — reservation_facilities가 유일한 소스이며, GET /api/bookings/:reservationId/facilities로
// 별도 조회한다.
interface BookingDto {
  reservationId: number;
  userId: number;
  roomId: number;
  hotelId: number;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  totalAmount: number;
  status: string;
  paymentDueAt: string; // 결제 마감 시각(ISO 8601). 없으면 빈 문자열
  lastPaymentAttemptStatus: string; // 최근 결제 시도 상태 REQUESTED/CONFIRMING/SUCCEEDED/FAILED. 없으면 빈 문자열 (CONFIRMING = 승인 요청 후 결과 확인 중 → 결제 버튼 막기)
  roomUnitId: number | null; // 배정된 호실 ID. 배정 전 null (gRPC에서는 0, LDP-89)
  roomNumber: string; // 배정된 방 번호. 배정 전 빈 문자열
}

// proto의 PreparePaymentResponse와 1:1 대응 (위키 API 명세 5.8)
interface PreparePaymentDto {
  orderId: string;
  amount: number;
  orderName: string;
  paymentDueAt: string;
}

// proto의 ConfirmPaymentResponse와 1:1 대응 (위키 API 명세 5.9). code는 FAILED일 때만 의미가 있다.
interface ConfirmPaymentResultDto {
  result: 'APPROVED' | 'FAILED' | 'UNKNOWN' | 'PROCESSING';
  retryable: boolean;
  code: string;
  message: string;
}

// proto의 HotelBookingStats 메시지와 1:1 대응되는 응답 형태
interface HotelBookingStatsDto {
  checkInsToday: number;
  checkOutsToday: number;
  occupiedRoomsToday: number;
  newReservationsToday: number;
  cancellationsToday: number;
  revenueToday: number;
}

// proto의 ReservationFacilityItem 메시지와 1:1 대응되는 응답 형태
interface ReservationFacilityDto {
  reservationFacilityId: number;
  reservationId: number;
  facilityId: number;
  facilityName: string;
  guestCount: number;
  totalAmount: number;
}

// proto의 BookingService 스펙과 1:1 대응되는 TS 인터페이스
interface BookingService {
  getHello(data: {}): Observable<{ message: string }>;
  getBookings(data: {}): Observable<{ bookings: BookingDto[] }>;
  getBookingsByUserId(data: {
    userId: number;
  }): Observable<{ bookings: BookingDto[] }>;
  getBookingById(data: { reservationId: number }): Observable<BookingDto>;
  cancelBooking(data: {
    reservationId: number;
    userId: number;
  }): Observable<BookingDto>;
  createBooking(data: {
    userId: number;
    roomId: number;
    hotelId: number;
    checkInDate: string;
    checkOutDate: string;
    guestCount: number;
    poolGuestCount?: number;
    loungeGuestCount?: number;
  }): Observable<BookingDto>;
  getReservationFacilitiesByReservationId(data: {
    reservationId: number;
  }): Observable<{ reservationFacilities: ReservationFacilityDto[] }>;
  getHotelBookingStats(data: {
    hotelId: number;
  }): Observable<HotelBookingStatsDto>;
  preparePayment(data: {
    reservationId: number;
    userId: number;
  }): Observable<PreparePaymentDto>;
  confirmPayment(data: {
    reservationId: number;
    userId: number;
    paymentKey: string;
    orderId: string;
    amount: number;
  }): Observable<ConfirmPaymentResultDto>;
  assignRoomUnit(data: {
    reservationId: number;
    roomUnitId: number;
  }): Observable<BookingDto>;
}

// 결제 API(5.8, 5.9)의 실패를 위키 API 명세 5.10 형식({ statusCode, error, code, message, retryable })으로 바꾼다.
// booking-service가 api-error 형식으로 던진 에러는 그대로 옮기고, 그 밖의 에러(서비스 연결 실패 등)는 500 계열로 둔다.
function toPaymentHttpError(err: unknown, fallbackMessage: string): Error {
  const payload = parseApiRpcError(err);
  if (payload) {
    return toHttpException(payload);
  }
  return toHttpException({
    status: 503,
    code: 'PAYMENT_SERVICE_UNAVAILABLE',
    message: fallbackMessage,
    retryable: true,
  });
}

// gRPC는 "배정 안 됨"을 0으로 보내므로 응답에서는 null로 바꿔 준다 (LDP-89)
function toBooking(booking: BookingDto): BookingDto {
  return {
    ...booking,
    roomUnitId: booking.roomUnitId || null,
    roomNumber: booking.roomNumber ?? '',
  };
}

function toBookings({ bookings = [] }: { bookings?: BookingDto[] }): {
  bookings: BookingDto[];
} {
  return { bookings: bookings.map(toBooking) };
}

@ApiTags('BookingService')
@ApiCommonResponses()
@Controller('api/bookings')
export class BookingController implements OnModuleInit {
  private bookingService!: BookingService;

  constructor(@Inject('BOOKING_SERVICE') private readonly client: ClientGrpc) {}

  // NestJS 생명주기: 모듈이 초기화될 때 gRPC 서비스 객체를 추출합니다.
  onModuleInit() {
    this.bookingService =
      this.client.getService<BookingService>('BookingService');
  }

  /**
   * GET http://localhost:3000/api/booking/hello
   * 브라우저/프론트엔드 HTTP 요청 수신 -> booking-service gRPC 호출
   */
  @Get('hello')
  @ApiOperation({
    summary: '예약 도메인 서버 헬스체크',
    description:
      'gRPC를 통해 booking-service 서버의 상태 및 Hello 메시지를 가져옵니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'Booking Hello World! 출력',
  })
  getHello(): Observable<{ message: string }> {
    return this.bookingService.getHello({});
  }

  /**
   * GET http://localhost:3000/api/bookings
   * 관리자 전용. 전체 예약 목록을 조회합니다.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '전체 예약 목록 조회 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. gRPC를 통해 booking-service의 전체 예약 목록을 가져옵니다.',
  })
  @ApiResponse({
    status: 200,
    description: '전체 예약 목록 조회 성공',
  })
  @ApiResponse({
    status: 403,
    description: '관리자 권한이 없음',
  })
  async getBookings(): Promise<{ bookings: BookingDto[] }> {
    return toBookings(
      await firstValueFrom(this.bookingService.getBookings({})),
    );
  }

  /**
   * GET http://localhost:3000/api/bookings/me
   * 로그인한 사용자 본인의 예약 목록을 조회합니다.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내 예약 목록 조회',
    description:
      '유효한 액세스 토큰을 가진 사용자 본인의 예약 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '내 예약 목록 조회 성공',
  })
  async getMyBookings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ bookings: BookingDto[] }> {
    return toBookings(
      await firstValueFrom(
        this.bookingService.getBookingsByUserId({ userId: user.userId }),
      ),
    );
  }

  /**
   * GET http://localhost:3000/api/bookings/hotels/{hotelId}/stats
   * 관리자 전용. 호텔 상세 페이지의 "호텔별 지표" 섹션이 사용하는 오늘자 집계를 조회합니다.
   */
  @Get('hotels/:hotelId/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'hotelId', description: '조회할 호텔의 ID', type: Number })
  @ApiOperation({
    summary: '호텔별 오늘자 예약 지표 조회 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. gRPC를 통해 booking-service에서 이 호텔의 오늘자 체크인/체크아웃/점유 객실 수/신규 예약/취소/매출을 집계해 가져옵니다. 점유율 계산에 필요한 총 객실 수는 이 응답에 포함되지 않으므로 GET /api/hotels/:hotelId/rooms 결과와 함께 사용해야 합니다.',
  })
  @ApiResponse({ status: 200, description: '호텔별 지표 조회 성공' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  async getHotelBookingStats(
    @Param('hotelId', ParseIntPipe) hotelId: number,
  ): Promise<HotelBookingStatsDto> {
    return firstValueFrom(
      this.bookingService.getHotelBookingStats({ hotelId }),
    );
  }

  /**
   * GET http://localhost:3000/api/bookings/:userId
   * 관리자 전용. 특정 유저의 예약 목록을 조회합니다.
   */
  @Get(':userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'userId', description: '조회할 유저의 ID', type: Number })
  @ApiOperation({
    summary: '특정 유저 예약 목록 조회 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. userId로 특정 유저의 예약 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '예약 목록 조회 성공',
  })
  @ApiResponse({
    status: 403,
    description: '관리자 권한이 없음',
  })
  async getBookingsByUserId(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ bookings: BookingDto[] }> {
    return toBookings(
      await firstValueFrom(this.bookingService.getBookingsByUserId({ userId })),
    );
  }

  /**
   * PUT http://localhost:3000/api/bookings/{reservationId}
   * 로그인한 사용자 본인의 예약을 취소합니다. status를 CANCELLED로 변경하고, 예약했던 기간의
   * 예약 가능일(room_availabilities)을 복구합니다.
   * TODO(환불): payment-service 연동 후 결제 환불 처리를 이 취소 흐름에 추가해야 한다.
   */
  @Put(':reservationId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'reservationId',
    description: '취소할 예약 PK ID',
    type: Number,
  })
  @ApiOperation({
    summary: '예약 취소',
    description:
      '유효한 액세스 토큰을 가진 사용자 본인의 예약만 취소할 수 있습니다. gRPC를 통해 booking-service에 예약 상태 변경 및 예약 가능일 복구를 요청합니다.',
  })
  @ApiResponse({ status: 200, description: '예약 취소 성공' })
  @ApiResponse({ status: 403, description: '본인의 예약이 아님' })
  @ApiResponse({ status: 404, description: '존재하지 않는 예약' })
  @ApiResponse({ status: 409, description: '이미 취소되었거나 완료된 예약' })
  async cancelBooking(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BookingDto> {
    const booking = await firstValueFrom(
      this.bookingService.cancelBooking({ reservationId, userId: user.userId }),
    ).catch((err) => {
      const message =
        err?.details || err?.message || '예약 취소에 실패했습니다.';
      if (message.includes('본인의 예약만')) {
        throw new ForbiddenException(message);
      }
      if (message.includes('이미 취소')) {
        throw new ConflictException(message);
      }
      throw new NotFoundException(message);
    });
    return toBooking(booking);
  }

  /**
   * POST http://localhost:3000/api/bookings
   * 로그인한 사용자 본인 명의로 신규 예약을 생성합니다.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '예약 생성',
    description:
      '유효한 액세스 토큰을 가진 사용자 본인 명의로 예약을 생성합니다. checkInDate부터 checkOutDate 전날까지 ' +
      '해당 객실 타입이 판매 중이고 남은 방이 1개 이상이어야 하며, 예약 생성과 동시에 ' +
      '해당 기간의 날짜별 예약 수(booked_count)가 1씩 늘어납니다. 예약 금액은 해당 기간의 일별 가격 합계로 자동 계산됩니다.',
  })
  @ApiResponse({ status: 201, description: '예약 생성 성공' })
  @ApiResponse({
    status: 400,
    description: '체크아웃 날짜가 체크인 날짜보다 이르거나 같음',
  })
  @ApiResponse({
    status: 404,
    description:
      '예약 가능한 객실이 아니거나(날짜 누락/이미 예약됨) 존재하지 않는 객실',
  })
  async createBooking(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBookingDto,
  ): Promise<BookingDto> {
    if (dto.checkInDate >= dto.checkOutDate) {
      throw new BadRequestException(
        'checkOutDate는 checkInDate보다 이후여야 합니다.',
      );
    }
    const booking = await firstValueFrom(
      this.bookingService.createBooking({ userId: user.userId, ...dto }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '예약 가능한 객실이 아닙니다.',
      );
    });
    return toBooking(booking);
  }

  /**
   * PUT http://localhost:3000/api/bookings/{reservationId}/room-unit
   * 관리자 전용. 예약에 호실을 배정·변경·해제합니다 (LDP-89). 예약은 객실 종류의 재고만 잡고 호실은 직원이 배정한다.
   */
  @Put(':reservationId/room-unit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({
    name: 'reservationId',
    description: '호실을 배정할 예약 PK ID',
    type: Number,
  })
  @ApiOperation({
    summary: '예약 호실 배정·변경·해제 (관리자 전용)',
    description:
      '결제 대기·예약 확정 예약에, 같은 객실 종류의 ACTIVE 호실을 배정합니다. ' +
      '같은 호실·겹치는 기간에 다른 배정이 있으면 거절합니다. roomUnitId를 null로 보내면 배정을 해제합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '배정 후 예약 (roomUnitId·roomNumber 포함)',
  })
  @ApiResponse({
    status: 404,
    description: 'RESERVATION_NOT_FOUND / ROOM_UNIT_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_RESERVATION_STATUS / ROOM_UNIT_NOT_ASSIGNABLE / ROOM_UNIT_ASSIGNMENT_CONFLICT / ROOM_UNIT_BUSY',
  })
  async assignRoomUnit(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Body() dto: AssignRoomUnitDto,
  ): Promise<BookingDto> {
    const booking = await firstValueFrom(
      this.bookingService.assignRoomUnit({
        reservationId,
        roomUnitId: dto.roomUnitId ?? 0,
      }),
    ).catch((err) => {
      const payload = parseApiRpcError(err);
      throw toHttpException(
        payload ?? {
          status: 503,
          code: 'BOOKING_SERVICE_UNAVAILABLE',
          message:
            '호실 배정을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
          retryable: true,
        },
      );
    });
    return toBooking(booking);
  }

  /**
   * POST http://localhost:3000/api/bookings/{reservationId}/payment-attempts
   * 결제 준비 (위키 API 명세 5.8). "결제하기"를 누를 때마다 새 결제 시도와 새 주문번호를 만든다.
   */
  @Post(':reservationId/payment-attempts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'reservationId',
    description: '결제할 예약 PK ID',
    type: Number,
  })
  @ApiOperation({
    summary: '결제 준비',
    description:
      '본인 예약·결제 대기 상태·결제 마감 전·결제 시도 5회 미만을 확인한 뒤 새 결제 시도를 기록하고, ' +
      '토스 결제창에 넘길 주문번호(orderId)·금액(amount)·주문명(orderName)·결제 마감 시각(paymentDueAt)을 돌려줍니다.',
  })
  @ApiResponse({ status: 201, description: '결제 준비 성공' })
  @ApiResponse({ status: 403, description: 'NOT_RESERVATION_OWNER' })
  @ApiResponse({ status: 404, description: 'RESERVATION_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_RESERVATION_STATUS / PAYMENT_DUE_EXPIRED / MAX_PAYMENT_ATTEMPTS_EXCEEDED',
  })
  async preparePayment(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PreparePaymentDto> {
    return firstValueFrom(
      this.bookingService.preparePayment({
        reservationId,
        userId: user.userId,
      }),
    ).catch((err) => {
      throw toPaymentHttpError(
        err,
        '결제 준비에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      );
    });
  }

  /**
   * POST http://localhost:3000/api/bookings/{reservationId}/payment-attempts/confirm
   * 결제 승인 (위키 API 명세 5.9). 결제 결과(승인·거절·확인 중)는 모두 200으로 내려가고 result로 구분한다.
   */
  @Post(':reservationId/payment-attempts/confirm')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'reservationId',
    description: '결제할 예약 PK ID',
    type: Number,
  })
  @ApiOperation({
    summary: '결제 승인',
    description:
      '토스 결제창 성공 URL로 받은 paymentKey·orderId·amount를 그대로 보냅니다. 결제 준비 때 받은 금액과 다르면 거절됩니다. ' +
      '같은 orderId로 다시 호출하면 처음 결과를 돌려줍니다. MOCK 모드에서는 paymentKey를 mock_{orderId}로 보냅니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'result: APPROVED / FAILED / UNKNOWN / PROCESSING',
  })
  @ApiResponse({ status: 403, description: 'NOT_RESERVATION_OWNER' })
  @ApiResponse({
    status: 404,
    description: 'RESERVATION_NOT_FOUND / PAYMENT_ATTEMPT_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description:
      'AMOUNT_MISMATCH / INVALID_RESERVATION_STATUS / PAYMENT_DUE_EXPIRED',
  })
  async confirmPayment(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmPaymentDto,
  ): Promise<ConfirmPaymentResultDto> {
    return firstValueFrom(
      this.bookingService.confirmPayment({
        reservationId,
        userId: user.userId,
        ...dto,
      }),
    ).catch((err) => {
      throw toPaymentHttpError(
        err,
        '결제 승인 요청에 실패했습니다. 잠시 후 예약 내역에서 확인해 주세요.',
      );
    });
  }

  /**
   * GET http://localhost:3000/api/bookings/{reservationId}/facilities
   * 로그인한 사용자 본인 예약에 연결된 편의시설(수영장/라운지 등) 이용 내역을 조회합니다.
   * getBookingById는 소유자 검증 없이 조회만 하므로(다른 서비스 간 호출용으로 설계됨), 여기서
   * cancelBooking과 동일하게 reservation.userId와 요청자를 직접 비교해 검증한다.
   */
  @Get(':reservationId/facilities')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'reservationId',
    description: '조회할 예약 PK ID',
    type: Number,
  })
  @ApiOperation({
    summary: '예약 편의시설 이용 내역 조회',
    description:
      '유효한 액세스 토큰을 가진 사용자 본인의 예약에 대해서만 조회할 수 있습니다. gRPC를 통해 booking-service의 reservation_facilities 목록을 가져옵니다.',
  })
  @ApiResponse({ status: 200, description: '편의시설 이용 내역 조회 성공' })
  @ApiResponse({ status: 403, description: '본인의 예약이 아님' })
  @ApiResponse({ status: 404, description: '존재하지 않는 예약' })
  async getReservationFacilities(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ facilities: ReservationFacilityDto[] }> {
    const booking = await firstValueFrom(
      this.bookingService.getBookingById({ reservationId }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '존재하지 않는 예약입니다.',
      );
    });
    if (booking.userId !== user.userId) {
      throw new ForbiddenException('본인의 예약만 조회할 수 있습니다.');
    }

    const { reservationFacilities } = await firstValueFrom(
      this.bookingService.getReservationFacilitiesByReservationId({
        reservationId,
      }),
    );
    return { facilities: reservationFacilities };
  }
}
