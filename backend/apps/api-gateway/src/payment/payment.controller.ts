import { createHmac } from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import type { Request } from 'express';
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
  adminHotelScope,
  assertAdminHotel,
  grpcErrorToHttp,
  grpcServerErrorToHttp,
} from '@app/common';
import { toBookingLookupError } from '../booking/booking.controller';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import {
  AdminUserPaymentListQueryDto,
  MyPaymentListQueryDto,
} from './dto/my-payment-list.dto';
import { listPage } from '../list-page';

// 서버 쪽 장애일 때 응답 (LDP-238). 내부 오류 원문 대신 이 문구를 돌려준다.
const PAYMENT_UNAVAILABLE = {
  code: 'PAYMENT_SERVICE_UNAVAILABLE',
  message:
    '결제 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};

const DEFAULT_MOCK_PG_SECRET = 'mock-pg-secret';

// proto의 Payment 메시지와 1:1 대응되는 응답 형태
interface PaymentDto {
  paymentId: number;
  reservationId: number;
  approvalNumber: string;
  amount: number;
  paymentMethod: string;
  status: string;
  paidAt: string;
  userId: number;
  receiptUrl: string; // 토스 영수증 주소 (토스 결제만, 없으면 빈 문자열) — LDP-124
  refundedAt: string; // 환불 완료 시각 ISO 문자열 (환불 전이면 빈 문자열) — LDP-139
}

// proto의 PaymentWebhookRequest 메시지와 1:1 대응 (signature는 여기서 검증만 하고 넘기지 않음)
interface PaymentWebhookRequest {
  eventType: string;
  paymentKey: string;
  orderId: string;
  amount: number;
  paymentMethod: string;
  approvalNumber: string;
  status: string;
  occurredAt: string;
}

// proto의 PaymentService 스펙과 1:1 대응되는 TS 인터페이스
interface PaymentService {
  getHello(data: Record<string, never>): Observable<{ message: string }>;
  handlePaymentWebhook(
    data: PaymentWebhookRequest,
  ): Observable<Record<string, never>>;
  getPaymentById(data: { paymentId: number }): Observable<PaymentDto>;
  getPaymentsByUserId(data: {
    userId: number;
    reservationId?: number;
    page?: number;
    size?: number;
    reservationIds?: number[];
  }): Observable<{ payments?: PaymentDto[]; total?: number }>;
  getMyPayment(data: {
    userId: number;
    paymentId: number;
  }): Observable<PaymentDto>;
}

// proto(booking.proto)의 BookingService 중 관리자 지점 확인에 쓰는 것 (LDP-178)
interface BookingLookupService {
  getBookingById(data: {
    reservationId: number;
  }): Observable<{ hotelId: number }>;
  getBookingsByUserId(data: {
    userId: number;
    hotelId?: number;
  }): Observable<{ bookings?: { reservationId: number; hotelId: number }[] }>;
}

// gRPC 클라이언트가 던지는 에러 형태 (nestjs/microservices의 RpcException을 클라이언트가
// 받으면 이 형태로 옴). 메시지는 details/message 둘 중 하나에 실려 온다.
interface GrpcErrorLike {
  details?: string;
  message?: string;
}

@ApiTags('PaymentService')
@ApiCommonResponses()
@Controller('api/payments')
export class PaymentController implements OnModuleInit {
  private paymentService!: PaymentService;
  private bookingService!: BookingLookupService;

  constructor(
    @Inject('PAYMENT_SERVICE') private readonly client: ClientGrpc,
    @Inject('BOOKING_SERVICE') private readonly bookingClient: ClientGrpc,
  ) {}

  // NestJS 생명주기: 모듈이 초기화될 때 gRPC 서비스 객체를 추출합니다.
  onModuleInit() {
    this.paymentService =
      this.client.getService<PaymentService>('PaymentService');
    this.bookingService =
      this.bookingClient.getService<BookingLookupService>('BookingService');
  }

  /**
   * GET http://localhost:3000/api/payment/hello
   * 브라우저/프론트엔드 HTTP 요청 수신 -> payment-service gRPC 호출
   */
  @Get('hello')
  @ApiOperation({
    summary: '결제 도메인 서버 헬스체크',
    description:
      'gRPC를 통해 payment-service 서버의 상태 및 Hello 메시지를 가져옵니다.',
  })
  @ApiResponse({
    status: 200,
    description: '{ Payment Hello World! 출력 }',
  })
  getHello(): Observable<{ message: string }> {
    return this.paymentService.getHello({});
  }

  /**
   * POST http://localhost:3000/api/payments/webhook
   * PG(pg-mock-service, 실제로는 실제 PG사 서버)가 승인/취소 결과를 비동기로 통보하는
   * 엔드포인트입니다. 호출자가 로그인한 유저가 아니라 PG 서버이므로 JWT 대신 HMAC 서명으로
   * 신원을 검증합니다.
   */
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'PG 결제 결과 웹훅 수신',
    description:
      'PG(mock) 서버가 승인/취소 결과를 서버-투-서버로 통보하는 엔드포인트입니다. ' +
      'JWT 인증 대신 HMAC 서명(MOCK_PG_SECRET)으로 요청 주체를 검증합니다.',
  })
  @ApiResponse({ status: 200, description: '정상 수신' })
  @ApiResponse({ status: 400, description: '서명이 유효하지 않음' })
  async handleWebhook(
    @Req() req: Request,
    @Body() dto: PaymentWebhookDto,
  ): Promise<{ received: true }> {
    // req.body는 ValidationPipe의 class-transformer 변환을 거치지 않은, express가 파싱한
    // 원본 객체라 pg-mock-service가 서명할 때 쓴 JSON 키 순서가 그대로 보존되어 있습니다.
    // dto(다음 파라미터)는 이미 class로 변환된 값이라 재직렬화 시 키 순서가 보장되지 않으므로
    // 서명 검증에는 쓰지 않습니다.
    this.verifySignature(req.body as Record<string, unknown>);

    await firstValueFrom(
      this.paymentService.handlePaymentWebhook({
        eventType: dto.eventType,
        paymentKey: dto.paymentKey,
        orderId: dto.orderId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        approvalNumber: dto.approvalNumber,
        status: dto.status,
        occurredAt: dto.occurredAt,
      }),
    ).catch((err: unknown) => {
      const grpcErr = err as GrpcErrorLike;
      const unavailable = grpcServerErrorToHttp(err, PAYMENT_UNAVAILABLE);
      if (unavailable) throw unavailable;
      throw new BadGatewayException(
        grpcErr.details || grpcErr.message || '웹훅 처리에 실패했습니다.',
      );
    });

    return { received: true };
  }

  /**
   * GET http://localhost:3000/api/payments/me
   * 로그인한 사용자 본인의 결제 목록을 조회합니다.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내 결제 목록 조회',
    description:
      '유효한 액세스 토큰을 가진 사용자 본인의 결제 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '{ payments, total }' })
  @ApiResponse({ status: 400, description: '조건 값이 잘못됨' })
  async getMyPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyPaymentListQueryDto = {},
  ): Promise<{ payments: PaymentDto[]; total: number }> {
    // 실패 = 결제 서비스 장애·타임아웃 → 503 (LDP-198, catch가 없으면 500으로 나가 일시 장애와 구분되지 않는다)
    const { payments = [], total = 0 } = await firstValueFrom(
      this.paymentService.getPaymentsByUserId({
        userId: user.userId,
        reservationId: query.reservationId ?? 0,
        ...listPage(query),
      }),
    ).catch((err) => {
      throw grpcErrorToHttp(err, {
        code: 'PAYMENT_SERVICE_UNAVAILABLE',
        message: '결제 내역을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
    });
    return { payments, total };
  }

  /**
   * GET http://localhost:3000/api/payments/me/{paymentId}
   * 로그인한 사용자 본인의 결제 한 건 — 결제 상세가 목록 전체 대신 씁니다 (부하 테스트 11-06).
   * (관리자용 :paymentId 단건 조회는 소유자를 확인하지 않아 손님이 쓸 수 없다.)
   */
  @Get('me/:paymentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'paymentId',
    description: '조회할 결제 PK ID',
    type: Number,
  })
  @ApiOperation({
    summary: '내 결제 단건 조회',
    description:
      '본인 결제 한 건을 돌려줍니다. 다른 회원의 결제면 없는 결제와 같이 404입니다.',
  })
  @ApiResponse({ status: 200, description: '내 결제 단건 조회 성공' })
  @ApiResponse({ status: 404, description: 'PAYMENT_NOT_FOUND' })
  async getMyPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ): Promise<PaymentDto> {
    return firstValueFrom(
      this.paymentService.getMyPayment({ userId: user.userId, paymentId }),
    ).catch((err) => {
      throw grpcErrorToHttp(
        err,
        {
          code: 'PAYMENT_SERVICE_UNAVAILABLE',
          message:
            '결제 내역을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
        },
        { 404: 'PAYMENT_NOT_FOUND' },
      );
    });
  }

  /**
   * GET http://localhost:3000/api/payments/users/{userId}
   * 관리자 전용. 특정 유저의 결제 목록을 조회합니다.
   * (:paymentId 단건 조회 라우트와 같은 세그먼트 깊이에서 충돌하지 않도록 users/ 접두사로 구분한다.)
   */
  @Get('users/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'userId', description: '조회할 유저의 ID', type: Number })
  @ApiOperation({
    summary: '특정 유저 결제 목록 조회 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. userId로 특정 유저의 결제 목록을 조회합니다. ' +
      'reservationIds로 예약을 고르고, page를 주면 그 페이지만, 생략하면 최신순 앞쪽 100건까지 돌려줍니다. total은 조건에 맞는 전체 개수입니다.',
  })
  @ApiResponse({ status: 200, description: '{ payments, total }' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  async getPaymentsByUserId(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: AdminUserPaymentListQueryDto = {},
  ): Promise<{ payments: PaymentDto[]; total: number }> {
    let reservationIds = query.reservationIds ?? [];
    // 지점 관리자·직원에게는 자기 지점 예약의 결제만 (LDP-178). 결제에는 지점이 없어 회원의 예약으로 거른다 —
    // 예약 전체를 받아 gateway에서 거르지 않고, 그 지점 예약 번호만 받아 결제 조회 조건으로 넘긴다 (부하 테스트 11-06)
    const scope = adminHotelScope(admin);
    if (scope !== null) {
      const { bookings = [] } = await firstValueFrom(
        this.bookingService.getBookingsByUserId({ userId, hotelId: scope }),
      ).catch((err) => {
        throw toBookingLookupError(err);
      });
      const scoped = bookings.map((booking) => booking.reservationId);
      reservationIds =
        reservationIds.length > 0
          ? reservationIds.filter((id) => scoped.includes(id))
          : scoped;
      if (reservationIds.length === 0) {
        return { payments: [], total: 0 };
      }
    }
    const { payments = [], total = 0 } = await firstValueFrom(
      this.paymentService.getPaymentsByUserId({
        userId,
        reservationIds,
        ...listPage(query),
      }),
    ).catch((err) => {
      throw grpcErrorToHttp(err, {
        code: 'PAYMENT_SERVICE_UNAVAILABLE',
        message: '결제 내역을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
    });
    return { payments, total };
  }

  /**
   * GET http://localhost:3000/api/payments/{paymentId}
   * 관리자 전용. 결제 상세 정보를 조회합니다.
   */
  @Get(':paymentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({
    name: 'paymentId',
    description: '조회할 결제 PK ID',
    type: Number,
  })
  @ApiOperation({
    summary: '결제 상세 조회 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. paymentId로 결제 상세 정보를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '결제 상세 조회 성공' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: '존재하지 않는 결제내역' })
  async getPaymentById(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ): Promise<PaymentDto> {
    const payment = await firstValueFrom(
      this.paymentService.getPaymentById({ paymentId }),
    ).catch((err: unknown) => {
      const grpcErr = err as GrpcErrorLike;
      const unavailable = grpcServerErrorToHttp(err, PAYMENT_UNAVAILABLE);
      if (unavailable) throw unavailable;
      const message =
        grpcErr.details || grpcErr.message || '결제 상세 조회에 실패했습니다.';
      if (message.includes('존재하지 않는 결제내역')) {
        throw new NotFoundException(message);
      }
      throw new BadGatewayException(message);
    });
    // 지점 관리자·직원은 자기 지점 예약의 결제만 (LDP-178)
    if (adminHotelScope(admin) !== null) {
      const booking = await firstValueFrom(
        this.bookingService.getBookingById({
          reservationId: payment.reservationId,
        }),
      ).catch((err) => {
        throw toBookingLookupError(err);
      });
      assertAdminHotel(admin, booking.hotelId);
    }
    return payment;
  }

  // pg-mock-service의 sendWebhook과 동일한 방식(signature 필드를 뺀 나머지를
  // JSON.stringify → HMAC-SHA256)으로 서명을 재계산해 비교합니다.
  private verifySignature(rawBody: Record<string, unknown>) {
    const { signature, ...payload } = rawBody;
    if (typeof signature !== 'string' || !signature) {
      throw new BadRequestException('웹훅 서명이 없습니다.');
    }

    const expected = createHmac(
      'sha256',
      process.env.MOCK_PG_SECRET || DEFAULT_MOCK_PG_SECRET,
    )
      .update(JSON.stringify(payload))
      .digest('hex');

    if (expected !== signature) {
      throw new BadRequestException('웹훅 서명이 유효하지 않습니다.');
    }
  }
}
