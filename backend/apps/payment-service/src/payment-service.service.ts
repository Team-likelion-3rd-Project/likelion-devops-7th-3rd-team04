import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
} from './entities/payment.entity';
import { PgMockClient } from './pg-mock/pg-mock.client';

// libs/common/src/proto/booking.proto의 BookingService / GetBookingById, ConfirmBooking과 1:1 대응
interface BookingGrpcService {
  getBookingById(data: { reservationId: number }): Observable<{
    reservationId: number;
    userId: number;
    totalAmount: number;
    status: string;
  }>;
  confirmBooking(data: { reservationId: number }): Observable<{
    reservationId: number;
    status: string;
  }>;
}

// proto의 Payment 메시지와 1:1 대응되는 응답 형태
export interface PaymentGrpcResponse {
  paymentId: number;
  reservationId: number;
  approvalNumber: string;
  amount: number;
  paymentMethod: string;
  status: string;
  paidAt: string;
  userId: number;
}

@Injectable()
export class PaymentServiceService implements OnModuleInit {
  private readonly logger = new Logger(PaymentServiceService.name);
  private bookingService!: BookingGrpcService;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @Inject('BOOKING_SERVICE') private readonly bookingClient: ClientGrpc,
    private readonly pgMockClient: PgMockClient,
  ) {}

  onModuleInit() {
    this.bookingService =
      this.bookingClient.getService<BookingGrpcService>('BookingService');
  }

  getHello(): string {
    return 'Payment Hello World!';
  }

  // 유저의 결제 요청을 처리한다.
  // 1) booking-service에서 예약을 조회해 금액/소유자/상태를 검증
  // 2) 이미 결제된 예약인지 확인 (중복 결제 방지)
  // 3) PG(pg-mock-service)에 결제 생성+승인을 동기로 요청
  // 4) 승인 응답을 그대로 결제내역(APPROVED)으로 저장
  // 실제 PG의 confirm API도 서버-투-서버 동기 호출로 그 자리에서 승인 결과를 받는 방식이라
  // (웹훅은 가상계좌 등 비동기 결제수단이나 사후 상태 통보용 보조 수단), 여기서도 동일하게
  // 승인 응답을 기다렸다가 즉시 결제내역을 확정 상태로 저장한다.
  async requestPayment(data: {
    reservationId: number;
    userId: number;
    paymentMethod: string;
  }): Promise<PaymentGrpcResponse> {
    const booking = await firstValueFrom(
      this.bookingService.getBookingById({
        reservationId: data.reservationId,
      }),
    ).catch(() => {
      throw new RpcException('존재하지 않는 예약입니다.');
    });

    if (booking.userId !== data.userId) {
      throw new RpcException('본인의 예약만 결제할 수 있습니다.');
    }
    if (booking.status !== 'PENDING_PAYMENT') {
      throw new RpcException('결제할 수 없는 예약 상태입니다.');
    }

    const alreadyPaid = await this.paymentRepository.findOne({
      where: {
        reservationId: data.reservationId,
        status: PaymentStatus.APPROVED,
      },
    });
    if (alreadyPaid) {
      throw new RpcException('이미 결제된 예약입니다.');
    }

    const result = await this.pgMockClient.createAndApprove({
      orderId: String(data.reservationId),
      amount: booking.totalAmount,
      orderName: `예약 #${data.reservationId} 결제`,
      paymentMethod: data.paymentMethod,
    });

    if (!result.approvalNumber) {
      // approve 성공 응답에는 항상 approvalNumber가 포함되므로(정상 흐름이라면) 도달하지
      // 않아야 하지만, PG 응답 계약이 깨진 경우를 대비한 방어 코드.
      this.logger.error(
        `PG 승인 응답에 approvalNumber가 없습니다. (reservationId=${data.reservationId})`,
      );
      throw new RpcException('결제 승인에 실패했습니다.');
    }

    const payment = this.paymentRepository.create({
      reservationId: data.reservationId,
      userId: data.userId,
      // 멱등 키/주문번호는 LDP-25(토스 승인 연동)에서 booking-service가 발급한 값으로 바뀝니다.
      // 그 전까지는 pg-mock에 보내던 값(orderId = 예약 ID)과 새 UUID로 채웁니다.
      idempotencyKey: randomUUID(),
      pgOrderId: String(data.reservationId),
      provider: PaymentProvider.MOCK,
      approvalNumber: result.approvalNumber,
      paymentKey: result.paymentKey,
      amount: booking.totalAmount,
      paymentMethod: data.paymentMethod,
      status: PaymentStatus.APPROVED,
      paidAt: result.approvedAt ? new Date(result.approvedAt) : new Date(),
    });
    const saved = await this.paymentRepository.save(payment);

    // 예약 확정 요청(PENDING_PAYMENT -> RESERVED). PG 승인은 이미 끝나 돈이 움직인 뒤이므로, 이
    // 호출이 실패해도 결제 요청 자체는 성공으로 응답한다 — 실패시키면 이미 승인된 결제를 없던 일로
    // 되돌려야 하는데(PG 재취소) 그건 더 위험하다. 실패하면 예약이 PENDING_PAYMENT로 남을 수 있지만,
    // cancelBooking은 이 상태와 무관하게 항상 RefundPayment를 호출하도록 구현돼 있어 환불 누락으로
    // 이어지지는 않는다(a안 정책, booking.proto의 CancelBooking 주석 참고). 정합성 자체는 로그로만
    // 남기고, 추후 필요 시 재시도/정산 배치로 보완한다.
    await firstValueFrom(
      this.bookingService.confirmBooking({ reservationId: data.reservationId }),
    ).catch((error: unknown) => {
      this.logger.error(
        `결제 승인 후 예약(#${data.reservationId}) 확정(PENDING_PAYMENT→RESERVED) 요청 실패`,
        error instanceof Error ? error.stack : String(error),
      );
    });

    return this.toGrpcResponse(saved);
  }

  // PG의 웹훅을 처리한다. api-gateway가 서명 검증까지 끝낸 뒤 호출하므로 여기서는 신뢰하고
  // 처리한다. requestPayment()의 동기 흐름이 이미 대부분을 처리하므로 이 메서드는 보조 역할만
  // 한다 (클래스 상단 주석/payment.proto의 HandlePaymentWebhook 설명 참고).
  async handlePaymentWebhook(data: {
    eventType: string;
    orderId: string;
    amount: number;
    paymentMethod: string;
    approvalNumber: string;
    paymentKey: string;
  }): Promise<void> {
    const reservationId = Number(data.orderId);
    if (!Number.isInteger(reservationId)) {
      this.logger.warn(
        `웹훅 orderId가 예약 ID 형식이 아닙니다: ${data.orderId}`,
      );
      return;
    }

    const existing = await this.paymentRepository.findOne({
      where: { reservationId, status: PaymentStatus.APPROVED },
    });

    if (data.eventType === 'PAYMENT.APPROVED') {
      if (existing) {
        // 동기 흐름(requestPayment)에서 이미 저장된 건 — 중복 생성 방지.
        return;
      }
      // 동기 흐름이 응답 수신 단계에서 실패했지만 PG는 실제 승인했던 경우의 구제.
      // userId는 웹훅 페이로드에 없으므로 booking-service에서 예약의 소유자를 조회해 채운다.
      const booking = await firstValueFrom(
        this.bookingService.getBookingById({ reservationId }),
      ).catch(() => {
        this.logger.error(
          `웹훅 구제 처리 중 예약(#${reservationId})을 찾을 수 없어 소유자(userId)를 확인하지 못했습니다.`,
        );
        return null;
      });
      if (!booking) {
        return;
      }

      const payment = this.paymentRepository.create({
        reservationId,
        userId: booking.userId,
        idempotencyKey: randomUUID(),
        pgOrderId: data.orderId,
        provider: PaymentProvider.MOCK,
        approvalNumber: data.approvalNumber,
        paymentKey: data.paymentKey,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        status: PaymentStatus.APPROVED,
        paidAt: new Date(),
      });
      await this.paymentRepository.save(payment);
      this.logger.warn(
        `동기 흐름에서 누락된 결제를 웹훅으로 구제했습니다 (reservationId=${reservationId})`,
      );

      // requestPayment()의 동기 흐름이 confirmBooking 호출 전에 끊겼을 수 있으므로 여기서도
      // 시도한다. 이미 RESERVED로 확정된 경우(confirmBooking까지는 성공했던 경우) booking-service가
      // 에러를 던지지만, 그 결과가 결제 구제 자체를 실패시키진 않으므로 로그만 남긴다.
      await firstValueFrom(
        this.bookingService.confirmBooking({ reservationId }),
      ).catch((error: unknown) => {
        this.logger.warn(
          `웹훅 구제 후 예약(#${reservationId}) 확정 요청 실패(이미 확정됐을 수 있음): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      return;
    }

    if (data.eventType === 'PAYMENT.CANCELED') {
      if (!existing) {
        this.logger.warn(
          `취소 웹훅을 받았지만 대응하는 결제내역이 없습니다 (reservationId=${reservationId})`,
        );
        return;
      }
      existing.status = PaymentStatus.REFUNDED;
      existing.refundedAt = new Date();
      await this.paymentRepository.save(existing);
      return;
    }

    this.logger.warn(`알 수 없는 웹훅 이벤트 타입: ${data.eventType}`);
  }

  // 단건 결제 상세 조회 (관리자 전용, 권한 검증은 api-gateway에서 수행)
  async getPaymentById(paymentId: number): Promise<PaymentGrpcResponse> {
    const payment = await this.paymentRepository.findOne({
      where: { paymentId },
    });
    if (!payment) {
      throw new RpcException('존재하지 않는 결제내역입니다.');
    }
    return this.toGrpcResponse(payment);
  }

  // 특정 유저의 결제 목록 조회. /me(본인 조회)와 /{userId}(관리자 조회) 양쪽에서 재사용된다.
  async getPaymentsByUserId(userId: number): Promise<PaymentGrpcResponse[]> {
    const payments = await this.paymentRepository.find({
      where: { userId },
      order: { paidAt: 'DESC' },
    });
    return payments.map((payment) => this.toGrpcResponse(payment));
  }

  // 예약 취소 시 booking-service가 항상 호출하는 내부용 환불 RPC (payment.proto의 RefundPayment
  // 주석 참고). APPROVED 결제가 없으면(결제 전 취소 등) no-op으로 조용히 반환한다 — booking-service가
  // reservation.status와 무관하게 매 취소마다 호출하므로, 이게 정상 흐름의 일부다.
  async refundPayment(reservationId: number): Promise<{ refunded: boolean }> {
    const payment = await this.paymentRepository.findOne({
      where: { reservationId, status: PaymentStatus.APPROVED },
    });
    if (!payment) {
      return { refunded: false };
    }
    // 승인된 결제는 항상 paymentKey가 있어야 하지만(승인 전에만 NULL), 데이터가 깨진 경우를 대비한 방어 코드.
    if (!payment.paymentKey) {
      throw new RpcException(
        `환불할 결제(#${payment.paymentId})에 PG 결제 키가 없습니다.`,
      );
    }

    // PG 취소 호출이 실패하면 결제내역은 APPROVED로 남겨둔 채 에러를 그대로 던진다 — 호출자
    // (booking-service.cancelBooking)가 로그만 남기고 예약취소 자체는 막지 않는 정책이다.
    // 여기서 임의로 REFUNDED로 바꾸면 실제로는 환불되지 않은 결제를 환불된 것처럼 기록하게 된다.
    await this.pgMockClient.cancel(payment.paymentKey, {
      cancelReason: '예약 취소',
    });

    // REFUND_REQUESTED/REFUND_FAILED를 거치는 환불 상태 전이는 LDP-28(토스 취소 연동)에서 붙입니다.
    payment.status = PaymentStatus.REFUNDED;
    payment.refundedAt = new Date();
    await this.paymentRepository.save(payment);
    return { refunded: true };
  }

  private toGrpcResponse(payment: Payment): PaymentGrpcResponse {
    return {
      paymentId: payment.paymentId,
      reservationId: payment.reservationId,
      // 승인 전(PROCESSING 등) 결제는 승인번호/승인 시각이 아직 없어서 빈 문자열로 내려줍니다
      // (proto3 string 필드는 null을 담을 수 없음).
      approvalNumber: payment.approvalNumber ?? '',
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      status: payment.status,
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : '',
      userId: payment.userId,
    };
  }
}
