import {
  ConflictException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
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
} from '@app/common';
import { CreateBookingDto } from './dto/create-booking.dto';

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
    return firstValueFrom(this.bookingService.getBookings({}));
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
    return firstValueFrom(
      this.bookingService.getBookingsByUserId({ userId: user.userId }),
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
    return firstValueFrom(this.bookingService.getHotelBookingStats({ hotelId }));
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
    return firstValueFrom(this.bookingService.getBookingsByUserId({ userId }));
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
    return firstValueFrom(
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
      '해당 객실의 room_availabilities가 예약 가능(isAvailable=true) 상태여야 하며, 예약 생성과 동시에 ' +
      '해당 기간은 전부 예약 불가(isAvailable=false)로 전환됩니다. 예약 금액은 해당 기간의 일별 가격 합계로 자동 계산됩니다.',
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
    return firstValueFrom(
      this.bookingService.createBooking({ userId: user.userId, ...dto }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '예약 가능한 객실이 아닙니다.',
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
