import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { PaymentServiceService } from './payment-service.service';

@Controller()
export class PaymentServiceController {
  constructor(private readonly paymentServiceService: PaymentServiceService) {}

  @GrpcMethod('PaymentService', 'GetHello')
  getHello(): { message: string } {
    return { message: this.paymentServiceService.getHello() };
  }

  // PG 웹훅. 서명 검증은 api-gateway에서 이미 끝난 뒤 호출된다. 지금은 기록(로그)만 한다 (LDP-102).
  @GrpcMethod('PaymentService', 'HandlePaymentWebhook')
  handlePaymentWebhook(data: {
    eventType: string;
    paymentKey: string;
    orderId: string;
    amount: number;
    paymentMethod: string;
    approvalNumber: string;
    status: string;
    occurredAt: string;
  }) {
    this.paymentServiceService.handlePaymentWebhook(data);
    return {};
  }

  // 단건 결제 상세 조회 (관리자 전용, 권한 검증은 api-gateway에서 수행)
  @GrpcMethod('PaymentService', 'GetPaymentById')
  async getPaymentById(data: { paymentId: number }) {
    return this.paymentServiceService.getPaymentById(data.paymentId);
  }

  // 특정 유저의 결제 목록 조회 (/me, /{userId} 양쪽에서 재사용)
  @GrpcMethod('PaymentService', 'GetPaymentsByUserId')
  async getPaymentsByUserId(data: { userId: number }) {
    const payments = await this.paymentServiceService.getPaymentsByUserId(
      data.userId,
    );
    return { payments };
  }

  // 결제 승인. booking-service의 ConfirmPayment(위키 API 명세 5.9)가 호출한다. REST로는 노출되지 않는다.
  @GrpcMethod('PaymentService', 'ApprovePayment')
  async approvePayment(data: {
    idempotencyKey: string;
    reservationId: number;
    userId: number;
    orderId: string;
    paymentKey: string;
    amount: number;
    orderName: string;
  }) {
    return this.paymentServiceService.approvePayment(data);
  }

  // 예약 취소 시 booking-service가 호출하는 내부용 환불 RPC. REST로는 노출되지 않는다.
  @GrpcMethod('PaymentService', 'RefundPayment')
  async refundPayment(data: {
    reservationId: number;
    refundIdempotencyKey: string;
  }) {
    return this.paymentServiceService.refundPayment(data);
  }
}
