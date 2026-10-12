import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CancelPaymentDto } from './dto/cancel-payment.dto';
import { PaymentRecordResponseDto } from './dto/payment-record-response.dto';
import { CreatePaymentResponseDto } from './dto/create-payment-response.dto';
import { ApprovePaymentResponseDto } from './dto/approve-payment-response.dto';
import { CancelPaymentResponseDto } from './dto/cancel-payment-response.dto';

@ApiTags('PG Mock - Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: '결제 요청 생성 (READY 상태로 생성)' })
  @ApiResponse({
    status: 201,
    description: '결제 요청 생성 성공',
    type: CreatePaymentResponseDto,
  })
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Get(':paymentKey')
  @ApiOperation({ summary: '결제 단건 상태 조회' })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: PaymentRecordResponseDto,
  })
  @ApiResponse({ status: 404, description: '존재하지 않는 paymentKey' })
  findOne(@Param('paymentKey') paymentKey: string) {
    return this.paymentsService.findOne(paymentKey);
  }

  @Post(':paymentKey/approve')
  @ApiOperation({
    summary: '결제 승인',
    description:
      '승인 성공 시 웹훅을 발송합니다. X-Mock-Result: fail 헤더를 보내면 승인 실패 상황을 재현합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '승인 성공',
    type: ApprovePaymentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'X-Mock-Result: fail 헤더로 인한 강제 승인 실패',
  })
  @ApiResponse({ status: 404, description: '존재하지 않는 paymentKey' })
  @ApiResponse({
    status: 409,
    description: '이미 처리된 결제 (READY 상태가 아님)',
  })
  approve(
    @Param('paymentKey') paymentKey: string,
    @Headers('x-mock-result') mockResult?: string,
  ) {
    return this.paymentsService.approve(paymentKey, mockResult);
  }

  @Post(':paymentKey/cancel')
  @ApiOperation({
    summary: '결제 취소',
    description: '취소 성공 시 웹훅을 발송합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '취소 성공',
    type: CancelPaymentResponseDto,
  })
  @ApiResponse({ status: 404, description: '존재하지 않는 paymentKey' })
  @ApiResponse({
    status: 409,
    description: '승인된(DONE) 결제가 아니라 취소할 수 없음',
  })
  cancel(
    @Param('paymentKey') paymentKey: string,
    @Body() dto: CancelPaymentDto,
  ) {
    return this.paymentsService.cancel(paymentKey, dto);
  }
}
