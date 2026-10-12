import { createHmac } from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseIntPipe,
  Post,
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
} from '@app/common';
import { CreatePaymentRequestDto } from './dto/create-payment-request.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

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
  requestPayment(data: {
    reservationId: number;
    userId: number;
    paymentMethod: string;
  }): Observable<PaymentDto>;
  handlePaymentWebhook(
    data: PaymentWebhookRequest,
  ): Observable<Record<string, never>>;
  getPaymentById(data: { paymentId: number }): Observable<PaymentDto>;
  getPaymentsByUserId(data: {
    userId: number;
  }): Observable<{ payments: PaymentDto[] }>;
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

  constructor(@Inject('PAYMENT_SERVICE') private readonly client: ClientGrpc) {}

  // NestJS 생명주기: 모듈이 초기화될 때 gRPC 서비스 객체를 추출합니다.
  onModuleInit() {
    this.paymentService =
      this.client.getService<PaymentService>('PaymentService');
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
   * POST http://localhost:3000/api/payments
   * 로그인한 사용자 본인 명의의 예약에 대해 결제를 요청합니다. payment-service가 예약 금액을
   * 조회·검증하고 PG(mock)에 결제 승인을 동기로 요청한 뒤, 성공 시 결제내역을 저장합니다.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '결제 요청',
    description:
      '유효한 액세스 토큰을 가진 사용자 본인 명의의 예약에 대해서만 결제를 요청할 수 있습니다. ' +
      'gRPC를 통해 payment-service가 예약 금액/소유자/상태를 검증하고, PG(mock)에 결제 생성+승인을 ' +
      '동기로 요청한 뒤 결제내역을 저장합니다.',
  })
  @ApiResponse({ status: 201, description: '결제 성공' })
  @ApiResponse({ status: 403, description: '본인의 예약이 아님' })
  @ApiResponse({ status: 404, description: '존재하지 않는 예약' })
  @ApiResponse({
    status: 409,
    description: '이미 결제되었거나 결제할 수 없는 예약 상태',
  })
  @ApiResponse({ status: 502, description: 'PG 서버 호출/승인 실패' })
  async requestPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentRequestDto,
  ): Promise<PaymentDto> {
    return firstValueFrom(
      this.paymentService.requestPayment({
        reservationId: dto.reservationId,
        paymentMethod: dto.paymentMethod,
        userId: user.userId,
      }),
    ).catch((err: unknown) => {
      const grpcErr = err as GrpcErrorLike;
      const message =
        grpcErr.details || grpcErr.message || '결제 요청에 실패했습니다.';
      if (message.includes('존재하지 않는 예약')) {
        throw new NotFoundException(message);
      }
      if (message.includes('본인의 예약만')) {
        throw new ForbiddenException(message);
      }
      if (
        message.includes('이미 결제') ||
        message.includes('결제할 수 없는 예약 상태')
      ) {
        throw new ConflictException(message);
      }
      throw new BadGatewayException(message);
    });
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
    description: '유효한 액세스 토큰을 가진 사용자 본인의 결제 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '내 결제 목록 조회 성공' })
  async getMyPayments(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ payments: PaymentDto[] }> {
    return firstValueFrom(
      this.paymentService.getPaymentsByUserId({ userId: user.userId }),
    );
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
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. userId로 특정 유저의 결제 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '결제 목록 조회 성공' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  async getPaymentsByUserId(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ payments: PaymentDto[] }> {
    return firstValueFrom(this.paymentService.getPaymentsByUserId({ userId }));
  }

  /**
   * GET http://localhost:3000/api/payments/{paymentId}
   * 관리자 전용. 결제 상세 정보를 조회합니다.
   */
  @Get(':paymentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'paymentId', description: '조회할 결제 PK ID', type: Number })
  @ApiOperation({
    summary: '결제 상세 조회 (관리자 전용)',
    description: '관리자 권한을 가진 사용자만 호출할 수 있습니다. paymentId로 결제 상세 정보를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '결제 상세 조회 성공' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: '존재하지 않는 결제내역' })
  async getPaymentById(
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ): Promise<PaymentDto> {
    return firstValueFrom(
      this.paymentService.getPaymentById({ paymentId }),
    ).catch((err: unknown) => {
      const grpcErr = err as GrpcErrorLike;
      const message =
        grpcErr.details || grpcErr.message || '결제 상세 조회에 실패했습니다.';
      if (message.includes('존재하지 않는 결제내역')) {
        throw new NotFoundException(message);
      }
      throw new BadGatewayException(message);
    });
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
