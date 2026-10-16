import { createHash, randomUUID } from 'crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import { DataSource, In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { apiRpcException, PaymentResultEvent } from '@app/common';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import {
  PaymentAttempt,
  PaymentAttemptStatus,
} from './entities/payment-attempt.entity';
import {
  PaymentResultEventType,
  PaymentResultInbox,
} from './entities/payment-result-inbox.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// 결제 마감: 예약 생성 후 이 시간 안에 결제가 끝나야 한다 (ERD 상태 모델, 위키 API 명세 5.1)
const PAYMENT_DUE_MINUTES = 30;
// 예약 1건당 결제 시도(결제 준비 호출) 최대 횟수 (10/13 프론트 합의, 위키 API 명세 5.8)
const MAX_PAYMENT_ATTEMPTS = 5;
// 승인을 요청한 뒤 결과가 이 시간 안에 확정되지 않으면 CONFIRMING 대신 REQUESTED로 내려 재결제를 허용한다 (LDP-67).
// 결과를 PG 조회로 확정해 주는 대사 배치가 아직 없어서, 확정되지 않은 시도가 결제 버튼을 계속 막지 않게 하려는 것.
// 그 사이 재결제로 이중 승인이 나도 payment-service가 ALREADY_PAID로 자동 취소한다.
const CONFIRMING_MINUTES = 10;

// 예약 취소 시 결제 서비스에 보내는 환불 멱등 키. 예약 ID로 항상 같은 값을 만들어서, 취소가 재시도되거나
// 두 번 들어와도 같은 키로 요청한다 → payments.refund_idempotency_key UNIQUE·토스 Idempotency-Key로 환불 1번.
// (UUID 형식 36자: payments.refund_idempotency_key CHAR(36))
function refundIdempotencyKey(reservationId: number): string {
  const hex = createHash('sha256')
    .update(`refund:reservation:${reservationId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// 결제 승인 결과 (위키 API 명세 5.9 result)
type ConfirmResultType = 'APPROVED' | 'FAILED' | 'UNKNOWN' | 'PROCESSING';

// proto의 ConfirmPaymentResponse와 1:1 대응
export interface ConfirmPaymentResponse {
  result: ConfirmResultType;
  retryable: boolean;
  code: string;
  message: string;
}

// proto의 PreparePaymentResponse와 1:1 대응
export interface PreparePaymentResponse {
  orderId: string;
  amount: number;
  orderName: string;
  paymentDueAt: string;
}

// libs/common/src/proto/hotel.proto의 HotelService / ReleaseRoomAvailability와 1:1 대응
interface HotelGrpcService {
  releaseRoomAvailability(data: {
    roomId: number;
    startDate: string;
    endDate: string;
  }): Observable<{ success: boolean }>;
}
// libs/common/src/proto/hotel.proto의 ReserveRoomAvailabilityResponse 메시지와 1:1 대응
interface ReserveRoomAvailabilityGrpcResponse {
  totalAmount: number;
}

interface HotelGrpcService {
  reserveRoomAvailability(data: {
    roomId: number;
    startDate: string;
    endDate: string;
  }): Observable<ReserveRoomAvailabilityGrpcResponse>;
}

// libs/common/src/proto/hotel.proto의 Facility 메시지와 1:1 대응
interface FacilityGrpcResponse {
  facilityId: number;
  hotelId: number;
  name: string;
  price: number;
}

// libs/common/src/proto/hotel.proto의 HotelService / GetFacilities와 1:1 대응
interface HotelGrpcService {
  getFacilities(data: {
    hotelId: number;
  }): Observable<{ facilities: FacilityGrpcResponse[] }>;
}

// libs/common/src/proto/payment.proto의 PaymentService / RefundPayment, ApprovePayment와 1:1 대응
interface PaymentGrpcService {
  refundPayment(data: {
    reservationId: number;
    refundIdempotencyKey: string;
  }): Observable<{ refunded: boolean; status: string }>;
  approvePayment(data: {
    idempotencyKey: string;
    reservationId: number;
    userId: number;
    orderId: string;
    paymentKey: string;
    amount: number;
    orderName: string;
  }): Observable<{
    result: ConfirmResultType;
    paymentId: number;
    retryable: boolean;
    code: string;
    message: string;
  }>;
}

// 'YYYY-MM-DD' 문자열에 일 단위 offset을 더한 'YYYY-MM-DD' 문자열을 반환한다 (UTC 기준 계산,
// date 컬럼은 시간대 정보가 없으므로 로컬 타임존에 영향받지 않도록 UTC로 계산한다).
function addDays(dateStr: string, offset: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// 서버 기준 오늘 날짜를 'YYYY-MM-DD'로 반환한다 (UTC 기준 — addDays/dayBefore와 동일한 원칙).
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 편의시설은 종류가 호텔마다 자유롭게 늘어날 수 있는 일반적인 카탈로그(hotel-service의 facilities
// 테이블)로 분리되어 있지만, 프론트/이 서비스는 아직 수영장·라운지 두 가지 고정 옵션만 지원한다.
// 호텔별 facilities 테이블에 아래 이름과 정확히 일치하는 row가 있어야 예약 시 해당 옵션을 선택할 수 있다.
const FACILITY_NAME_INDOOR_POOL = '수영장';
const FACILITY_NAME_LOUNGE = '라운지';

// proto의 Booking 메시지와 1:1 대응되는 응답 형태. 편의시설(수영장/라운지) 이용 여부/인원수는
// 여기 담지 않는다 — reservation_facilities가 유일한 소스이며, 필요하면
// getReservationFacilitiesByReservationId로 별도 조회한다.
export interface BookingGrpcResponse {
  reservationId: number;
  userId: number;
  roomId: number;
  hotelId?: number;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  totalAmount: number;
  status: string;
  paymentDueAt: string; // ISO 8601, 없으면 빈 문자열
  lastPaymentAttemptStatus: string; // REQUESTED/CONFIRMING/SUCCEEDED/FAILED, 시도 없으면 빈 문자열
}

// 호텔 상세 페이지의 "호텔별 지표" 섹션이 사용하는 응답. hotelId 스냅샷 컬럼 덕분에
// hotel-service 호출 없이 이 서비스의 reservations 테이블만으로 계산된다. proto의
// HotelBookingStats 메시지와 1:1 대응.
export interface HotelBookingStatsGrpcResponse {
  checkInsToday: number;
  checkOutsToday: number;
  occupiedRoomsToday: number;
  newReservationsToday: number;
  cancellationsToday: number;
  revenueToday: number;
}

@Injectable()
export class BookingServiceService implements OnModuleInit {
  private readonly logger = new Logger(BookingServiceService.name);
  private hotelService!: HotelGrpcService;
  private paymentService!: PaymentGrpcService;

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    @InjectRepository(PaymentAttempt)
    private readonly paymentAttemptRepository: Repository<PaymentAttempt>,
    private readonly dataSource: DataSource,
    private readonly reservationFacilityService: ReservationFacilityService,
    @Inject('HOTEL_SERVICE') private readonly hotelClient: ClientGrpc,
    @Inject('PAYMENT_SERVICE') private readonly paymentClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.hotelService =
      this.hotelClient.getService<HotelGrpcService>('HotelService');
    this.paymentService =
      this.paymentClient.getService<PaymentGrpcService>('PaymentService');
  }

  getHello(): string {
    return 'Booking Hello World!';
  }

  // 신규 예약 생성. checkInDate~(checkOutDate 하루 전)까지가 실제로 묵는 기간(박 수)이므로,
  // hotel-service의 ReserveRoomAvailability도 이 기간을 기준으로 검증/전환한다.
  // hotel-service가 이미 원자적으로 검증+전환을 수행하므로, 여기서는 그 결과(totalAmount)를 받아
  // 예약 row를 저장하기만 하면 된다.
  //
  // 편의시설(수영장/라운지) 요금은 hotel-service의 facilities 테이블에서 실제 단가(1인 1회 기준)를
  // 조회한 뒤 이용 인원수(poolGuestCount/loungeGuestCount)를 곱해 계산한다 — 예약 전체 인원수
  // (guestCount)와 무관하게 시설별로 실제 이용하는 인원만큼만 청구한다. 계산된 금액은
  // reservation_facilities에 시설별로 한 행씩 기록되어 나중에 예약 상세에서 조회할 수 있다
  // ([[facilities-reservation-facilities-design]] 메모리 참고).
  async createBooking(data: {
    userId: number;
    roomId: number;
    hotelId: number;
    checkInDate: string;
    checkOutDate: string;
    guestCount: number;
    poolGuestCount?: number;
    loungeGuestCount?: number;
  }): Promise<BookingGrpcResponse> {
    if (data.checkInDate >= data.checkOutDate) {
      throw new RpcException(
        '체크아웃 날짜는 체크인 날짜보다 이후여야 합니다.',
      );
    }

    const lastNightDate = addDays(data.checkOutDate, -1);

    const { totalAmount: roomAmount } = await firstValueFrom(
      this.hotelService.reserveRoomAvailability({
        roomId: data.roomId,
        startDate: data.checkInDate,
        endDate: lastNightDate,
      }),
    ).catch((err) => {
      throw new RpcException(
        err?.details || err?.message || '예약 가능한 객실이 아닙니다.',
      );
    });

    const facilitySelections = [
      { name: FACILITY_NAME_INDOOR_POOL, guestCount: data.poolGuestCount ?? 0 },
      { name: FACILITY_NAME_LOUNGE, guestCount: data.loungeGuestCount ?? 0 },
    ].filter((selection) => selection.guestCount > 0);

    let totalAmount = roomAmount;
    const reservationFacilityInputs: {
      facilityId: number;
      facilityName: string;
      guestCount: number;
      totalAmount: number;
    }[] = [];

    if (facilitySelections.length > 0) {
      const { facilities } = await firstValueFrom(
        this.hotelService.getFacilities({ hotelId: data.hotelId }),
      ).catch(() => {
        throw new RpcException('편의시설 정보를 확인할 수 없습니다.');
      });

      for (const selection of facilitySelections) {
        const facility = facilities.find((f) => f.name === selection.name);
        if (!facility) {
          throw new RpcException(
            `해당 호텔에 등록되지 않은 편의시설입니다: ${selection.name}`,
          );
        }
        const facilityAmount = facility.price * selection.guestCount;
        totalAmount += facilityAmount;
        reservationFacilityInputs.push({
          facilityId: facility.facilityId,
          facilityName: facility.name,
          guestCount: selection.guestCount,
          totalAmount: facilityAmount,
        });
      }
    }

    const reservation = this.reservationRepository.create({
      userId: data.userId,
      roomId: data.roomId,
      hotelId: data.hotelId,
      checkInDate: data.checkInDate,
      checkOutDate: data.checkOutDate,
      guestCount: data.guestCount,
      totalAmount,
      status: ReservationStatus.PENDING_PAYMENT,
      // 이 시각까지 결제가 끝나지 않으면 결제할 수 없고, 만료 배치가 EXPIRED로 돌린다
      paymentDueAt: new Date(Date.now() + PAYMENT_DUE_MINUTES * 60 * 1000),
    });
    const saved = await this.reservationRepository.save(reservation);

    for (const input of reservationFacilityInputs) {
      await this.reservationFacilityService.createReservationFacility({
        reservationId: saved.reservationId,
        facilityId: input.facilityId,
        facilityName: input.facilityName,
        guestCount: input.guestCount,
        totalAmount: input.totalAmount,
      });
    }

    return this.toGrpcResponse(saved);
  }

  // 전체 예약 목록 조회 (관리자 전용, 권한 검증은 api-gateway에서 수행)
  async getBookings(): Promise<BookingGrpcResponse[]> {
    const reservations = await this.reservationRepository.find({
      order: { createdAt: 'DESC' },
    });
    return this.toGrpcResponsesWithLastAttempt(reservations);
  }

  // 특정 유저의 예약 목록 조회. userId가 이 서비스의 DB에 존재하지 않아도(유저 존재 여부는
  // 검증할 수 없음, 서비스 간 DB 분리 원칙) 빈 배열을 그대로 반환한다.
  async getBookingsByUserId(userId: number): Promise<BookingGrpcResponse[]> {
    const reservations = await this.reservationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return this.toGrpcResponsesWithLastAttempt(reservations);
  }

  // 단건 예약 조회. payment-service가 결제 요청을 검증(금액/소유자/상태)하기 위해 호출한다.
  // 소유자(userId) 검증은 여기서 하지 않고 호출 측(payment-service)에 맡긴다 — 이 서비스의
  // 다른 조회 메서드(getBookings, getBookingsByUserId)도 호출자를 신뢰하고 필터링을 호출 측/
  // api-gateway 권한 검증에 맡기는 것과 같은 원칙이다.
  async getBookingById(reservationId: number): Promise<BookingGrpcResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId },
    });
    if (!reservation) {
      throw new RpcException('존재하지 않는 예약입니다.');
    }
    return this.toGrpcResponse(reservation);
  }

  // 본인 예약 취소. reservationId가 존재하지 않으면, 혹은 요청자가 예약자 본인이 아니면 RpcException.
  // 이미 취소/완료된 예약도 재취소할 수 없다. PENDING_PAYMENT(결제 전)/RESERVED(결제 완료) 둘 다
  // 취소 가능하다.
  // 1) Reservation.status를 CANCELLED로 먼저 확정한다 (이 서비스의 소스 오브 트루스).
  // 2) hotel-service에 room_availabilities 복구를 요청한다 — 체크아웃 당일은 다음 손님의 체크인일이므로
  //    막지 않고, 체크인일부터 체크아웃 전날까지만 되돌린다. 이 호출이 실패해도 예약 자체는 이미
  //    취소된 상태이므로 요청을 실패시키지 않고 로그만 남긴다(가용일 동기화는 별도로 복구 가능).
  // 3) payment-service에 환불을 요청한다. 취소 전 상태(PENDING_PAYMENT였는지 RESERVED였는지)와
  //    무관하게 항상 호출한다 — PAID 결제가 실제로 있는지 판단은 payment-service가 스스로 하도록
  //    맡긴다(RefundPayment 주석 참고). 이 호출도 hotel-service와 동일하게 실패해도 예약취소
  //    자체는 막지 않고 로그만 남긴다.
  async cancelBooking(
    reservationId: number,
    userId: number,
  ): Promise<BookingGrpcResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId },
    });
    if (!reservation) {
      throw new RpcException('존재하지 않는 예약입니다.');
    }
    if (reservation.userId !== userId) {
      throw new RpcException('본인의 예약만 취소할 수 있습니다.');
    }
    if (
      reservation.status !== ReservationStatus.PENDING_PAYMENT &&
      reservation.status !== ReservationStatus.RESERVED
    ) {
      throw new RpcException('이미 취소되었거나 완료된 예약입니다.');
    }

    // 조건부 UPDATE: 확인한 뒤 그 사이 상태가 바뀌었으면(결제 실패·만료 처리, 동시 취소 등) 취소하지 않는다
    const { affected } = await this.reservationRepository.update(
      {
        reservationId,
        status: In([
          ReservationStatus.PENDING_PAYMENT,
          ReservationStatus.RESERVED,
        ]),
      },
      { status: ReservationStatus.CANCELLED },
    );
    if (!affected) {
      throw new RpcException('이미 취소되었거나 완료된 예약입니다.');
    }
    reservation.status = ReservationStatus.CANCELLED;
    const saved = reservation;

    await this.releaseRoomAvailability(reservation, '취소');

    // 환불 요청 (LDP-28). 결과(REFUNDED / REFUND_FAILED)는 결제 결과 이벤트로도 들어와 inbox에 기록된다.
    // 결제가 없으면 결제 서비스가 NO_PAYMENT로 아무것도 하지 않는다.
    try {
      const refund = await firstValueFrom(
        this.paymentService.refundPayment({
          reservationId,
          refundIdempotencyKey: refundIdempotencyKey(reservationId),
        }),
      );
      if (refund.status === 'REFUND_FAILED') {
        this.logger.error(
          `[알람] 예약(#${reservationId}) 취소 후 환불 실패 — 결제 쪽에서 재시도 필요`,
        );
      }
    } catch (error) {
      this.logger.error(
        `예약(#${reservationId}) 취소 후 결제 환불 요청 실패`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return this.toGrpcResponse(saved);
  }

  // 결제 승인 완료 후 payment-service가 호출: PENDING_PAYMENT -> RESERVED로 전환한다.
  // PENDING_PAYMENT 상태가 아니면(이미 확정됐거나 취소된 예약에 뒤늦게 도달한 콜백 등) 에러.
  async confirmBooking(reservationId: number): Promise<BookingGrpcResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId },
    });
    if (!reservation) {
      throw new RpcException('존재하지 않는 예약입니다.');
    }
    if (reservation.status !== ReservationStatus.PENDING_PAYMENT) {
      throw new RpcException('결제 대기 상태의 예약이 아닙니다.');
    }

    reservation.status = ReservationStatus.RESERVED;
    const saved = await this.reservationRepository.save(reservation);
    return this.toGrpcResponse(saved);
  }

  // 결제 준비 (위키 API 명세 5.8). "결제하기"를 누를 때마다 새 결제 시도(payment_attempts)를 기록하고
  // 토스 결제창에 넘길 주문번호·금액을 돌려준다.
  //  - 시도마다 새 주문번호(pg_order_id)를 써서, 재결제해도 토스 주문번호가 이전 시도와 충돌하지 않는다.
  //  - 멱등 키(idempotency_key)도 시도마다 새로 만들어 payment-service 승인 호출에 쓴다 (프론트는 모름).
  //  - 금액은 예약에 저장된 금액(totalAmount)만 쓴다 — 승인 때 프론트가 보낸 금액과 대조해 위변조를 거른다.
  // 예약 행을 잠그고(비관적 락) 시도 횟수를 세서, "결제하기"를 동시에 여러 번 눌러도 5회를 넘지 않게 한다.
  async preparePayment(
    reservationId: number,
    userId: number,
  ): Promise<PreparePaymentResponse> {
    return this.dataSource.transaction(async (manager) => {
      const reservation = await manager.findOne(Reservation, {
        where: { reservationId },
        lock: { mode: 'pessimistic_write' },
      });
      this.assertPayableReservation(reservation, userId);

      const attemptCount = await manager.count(PaymentAttempt, {
        where: { reservationId },
      });
      if (attemptCount >= MAX_PAYMENT_ATTEMPTS) {
        throw apiRpcException({
          status: 409,
          code: 'MAX_PAYMENT_ATTEMPTS_EXCEEDED',
          message: `결제는 예약당 최대 ${MAX_PAYMENT_ATTEMPTS}번까지 시도할 수 있습니다.`,
          retryable: false,
        });
      }

      const attempt = await manager.save(
        manager.create(PaymentAttempt, {
          reservationId,
          idempotencyKey: randomUUID(),
          // 토스 orderId 규칙: 영문·숫자·-·_ 6~64자
          pgOrderId: `rsv${reservationId}-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          amount: reservation.totalAmount,
          status: PaymentAttemptStatus.REQUESTED,
        }),
      );

      return {
        orderId: attempt.pgOrderId,
        amount: attempt.amount,
        orderName: this.orderName(reservationId),
        paymentDueAt: this.paymentDueAt(reservation).toISOString(),
      };
    });
  }

  // 결제 승인 (위키 API 명세 5.9). 토스 결제창(또는 MOCK)이 돌려준 paymentKey·orderId·amount로
  // 시도와 금액을 대조한 뒤 payment-service에 승인을 요청한다.
  //  - 같은 orderId로 다시 호출하면(새로고침·중복 클릭) 처음 결과를 돌려준다 — 이미 끝난 시도는 다시 승인하지 않고,
  //    아직 처리 중이면 같은 멱등 키로 다시 요청하므로 payment-service가 결제를 1건만 만든다.
  //  - 결제 결과(승인·거절·확인 중)는 에러가 아니라 result로 돌려준다. 요청 자체가 잘못된 경우만 api-error.
  async confirmPayment(data: {
    reservationId: number;
    userId: number;
    paymentKey: string;
    orderId: string;
    amount: number;
  }): Promise<ConfirmPaymentResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId: data.reservationId },
    });
    if (!reservation) {
      throw this.reservationNotFound();
    }
    if (reservation.userId !== data.userId) {
      throw this.notOwner();
    }

    const attempt = await this.paymentAttemptRepository.findOne({
      where: { reservationId: data.reservationId, pgOrderId: data.orderId },
    });
    if (!attempt) {
      throw apiRpcException({
        status: 404,
        code: 'PAYMENT_ATTEMPT_NOT_FOUND',
        message:
          '결제 요청 정보를 찾을 수 없습니다. 결제를 다시 진행해 주세요.',
        retryable: true,
      });
    }

    // 이미 끝난 시도 → 처음 결과 그대로 (새로고침·중복 클릭)
    if (attempt.status === PaymentAttemptStatus.SUCCEEDED) {
      return {
        result: 'APPROVED',
        retryable: false,
        code: '',
        message: '결제가 승인되었습니다.',
      };
    }
    if (attempt.status === PaymentAttemptStatus.FAILED) {
      return this.failedAttemptResponse(reservation, attempt.failureReason);
    }

    this.assertPayableReservation(reservation, data.userId);

    // 금액 위변조: 결제 준비 때 서버가 정한 금액과 다르면 거절하고, 재시도 없이 예약을 PAYMENT_FAILED로 (ERD)
    if (data.amount !== attempt.amount) {
      this.logger.warn(
        `결제 금액 불일치 (reservationId=${data.reservationId}, orderId=${data.orderId}, 저장=${attempt.amount}, 요청=${data.amount})`,
      );
      await this.failAttempt(attempt, 'AMOUNT_MISMATCH');
      await this.failReservation(reservation);
      throw apiRpcException({
        status: 409,
        code: 'AMOUNT_MISMATCH',
        message: '결제 금액이 올바르지 않아 결제를 진행할 수 없습니다.',
        retryable: false,
      });
    }

    // 승인 요청 시각을 먼저 남긴다 — 이 뒤로는 "돈이 빠졌을 수도 있는" 시도라서, 결과가 확정될 때까지
    // 예약 응답에 CONFIRMING으로 나간다. 같은 orderId로 다시 호출해도 처음 시각을 유지한다.
    await this.paymentAttemptRepository.update(
      {
        attemptId: attempt.attemptId,
        status: PaymentAttemptStatus.REQUESTED,
        confirmRequestedAt: IsNull(),
      },
      { confirmRequestedAt: new Date() },
    );

    const approved = await firstValueFrom(
      this.paymentService.approvePayment({
        idempotencyKey: attempt.idempotencyKey,
        reservationId: data.reservationId,
        userId: data.userId,
        orderId: data.orderId,
        paymentKey: data.paymentKey,
        amount: attempt.amount,
        orderName: this.orderName(data.reservationId),
      }),
    ).catch((error: unknown) => {
      // payment-service 호출 자체가 실패 — 승인 요청이 처리됐는지 알 수 없으므로 시도는 REQUESTED로 두고 UNKNOWN.
      // 같은 orderId로 다시 호출하면 같은 멱등 키로 재요청되어 결제가 중복으로 생기지 않는다.
      this.logger.error(
        `결제 승인 요청 실패 (reservationId=${data.reservationId}, orderId=${data.orderId})`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    });

    if (
      !approved ||
      approved.result === 'UNKNOWN' ||
      approved.result === 'PROCESSING'
    ) {
      return {
        result: approved?.result ?? 'UNKNOWN',
        retryable: false,
        code: '',
        message:
          approved?.message ||
          '결제 결과를 확인하고 있습니다. 잠시 후 예약 내역에서 확인해 주세요.',
      };
    }

    if (approved.result === 'APPROVED') {
      // 시도 기록만 성공으로 남긴다. 예약 확정(PENDING_PAYMENT -> RESERVED)은 결제 결과 이벤트
      // (payment_outbox -> SQS FIFO -> applyPaymentResult)로만 반영한다 — ERD "예약 상태는 결과 이벤트
      // 경로로만 바뀐다". 보통 1초 안에 반영되고, 프론트는 GET /api/bookings/me 재조회로 확인한다.
      await this.paymentAttemptRepository.update(
        {
          attemptId: attempt.attemptId,
          status: PaymentAttemptStatus.REQUESTED,
        },
        { status: PaymentAttemptStatus.SUCCEEDED },
      );
      return {
        result: 'APPROVED',
        retryable: false,
        code: '',
        message: approved.message || '결제가 승인되었습니다.',
      };
    }

    // FAILED
    await this.failAttempt(attempt, approved.code || 'PAYMENT_DECLINED');
    const attemptCount = await this.paymentAttemptRepository.count({
      where: { reservationId: data.reservationId },
    });
    if (!approved.retryable || attemptCount >= MAX_PAYMENT_ATTEMPTS) {
      // 더 시도할 수 없음 → 예약을 PAYMENT_FAILED로 돌리고 재고 반환 (ERD 상태 모델)
      if (approved.code !== 'ALREADY_PAID') {
        await this.failReservation(reservation);
      }
      return {
        result: 'FAILED',
        retryable: false,
        code:
          approved.code === 'ALREADY_PAID'
            ? approved.code
            : 'MAX_PAYMENT_ATTEMPTS_EXCEEDED',
        message:
          approved.code === 'ALREADY_PAID'
            ? approved.message
            : `결제에 ${MAX_PAYMENT_ATTEMPTS}번 실패해 예약이 취소되었습니다. 다시 예약해 주세요.`,
      };
    }
    return {
      result: 'FAILED',
      retryable: true,
      code: approved.code || 'PAYMENT_DECLINED',
      message: approved.message,
    };
  }

  // 결제 결과 이벤트 반영 (payment_outbox -> SQS FIFO -> 여기, ERD "이벤트별 메인 처리").
  // payment_result_inbox 기록과 예약·시도 상태 변경을 한 트랜잭션으로 묶는다. event_id가 UNIQUE라서
  // 같은 이벤트가 두 번 와도(큐 재전송·발행기 재시도) 두 번째 INSERT가 막혀 한 번만 반영된다 (Inbox 패턴).
  // 처리에 실패하면 에러를 그대로 던진다 — 수신기가 메시지를 지우지 않아 큐가 다시 보내고,
  // 5번 실패하면 DLQ(payment-result-dlq.fifo)로 옮겨진다.
  async applyPaymentResult(event: PaymentResultEvent): Promise<void> {
    const reservationToRelease = await this.dataSource.transaction(
      async (manager) => {
        const attempt = event.orderId
          ? await manager.findOne(PaymentAttempt, {
              where: { pgOrderId: event.orderId },
            })
          : null;

        try {
          await manager.save(
            manager.create(PaymentResultInbox, {
              eventId: event.eventId,
              eventType: event.eventType as PaymentResultEventType,
              reservationId: event.reservationId,
              attemptId: attempt?.attemptId,
              paymentId: event.paymentId,
              payload: event as unknown as Record<string, unknown>,
            }),
          );
        } catch (error: unknown) {
          if (
            error instanceof QueryFailedError &&
            (error.driverError as { code?: string })?.code === 'ER_DUP_ENTRY'
          ) {
            this.logger.log(
              `이미 처리한 결제 결과 이벤트입니다 — 건너뜁니다 (event_id=${event.eventId})`,
            );
            return null;
          }
          throw error;
        }

        let release: Reservation | null = null;
        switch (event.eventType) {
          case 'PAYMENT_APPROVED': {
            if (attempt) {
              await manager.update(
                PaymentAttempt,
                {
                  attemptId: attempt.attemptId,
                  status: PaymentAttemptStatus.REQUESTED,
                },
                { status: PaymentAttemptStatus.SUCCEEDED },
              );
            }
            const { affected } = await manager.update(
              Reservation,
              {
                reservationId: event.reservationId,
                status: ReservationStatus.PENDING_PAYMENT,
              },
              { status: ReservationStatus.RESERVED },
            );
            if (!affected) {
              const current = await manager.findOne(Reservation, {
                where: { reservationId: event.reservationId },
              });
              if (current?.status !== ReservationStatus.RESERVED) {
                // 결제는 승인됐는데 예약이 이미 만료·취소·실패 상태 → 돈만 빠져나간 상태라 환불이 필요하다
                // (토스 취소 연동 LDP-28 / 대사 배치에서 처리). 지금은 알람 로그로 남긴다.
                this.logger.error(
                  `[알람] 결제 승인 이벤트를 받았지만 예약(#${event.reservationId})이 ${current?.status} 상태입니다 — 환불 필요 (paymentId=${event.paymentId})`,
                );
              }
            }
            break;
          }
          case 'PAYMENT_FAILED': {
            if (attempt) {
              await manager.update(
                PaymentAttempt,
                {
                  attemptId: attempt.attemptId,
                  status: PaymentAttemptStatus.REQUESTED,
                },
                {
                  status: PaymentAttemptStatus.FAILED,
                  failureReason: 'PAYMENT_DECLINED',
                },
              );
            }
            // 재시도할 수 있는 실패면 예약은 그대로(PENDING_PAYMENT), 재시도 불가면 PAYMENT_FAILED + 재고 반환
            if (!event.retryable) {
              const { affected } = await manager.update(
                Reservation,
                {
                  reservationId: event.reservationId,
                  status: ReservationStatus.PENDING_PAYMENT,
                },
                { status: ReservationStatus.PAYMENT_FAILED },
              );
              if (affected) {
                release = await manager.findOne(Reservation, {
                  where: { reservationId: event.reservationId },
                });
              }
            }
            break;
          }
          case 'PAYMENT_REFUND_FAILED':
            this.logger.error(
              `[알람] 환불 실패 이벤트 (reservationId=${event.reservationId}, paymentId=${event.paymentId}) — 결제 쪽 대사 배치가 재시도합니다.`,
            );
            break;
          case 'PAYMENT_REFUNDED':
          default:
            // 환불 완료는 예약이 이미 CANCELLED 상태라 기록만 남긴다
            break;
        }

        await manager.update(
          PaymentResultInbox,
          { eventId: event.eventId },
          { processedAt: new Date() },
        );
        return release;
      },
    );

    // 재고 반환은 다른 서비스(hotel) 호출이라 트랜잭션이 끝난 뒤에 한다
    if (reservationToRelease) {
      await this.releaseRoomAvailability(reservationToRelease, '결제 실패');
    }
  }

  // 결제 가능한 예약인지 (본인 · 결제 대기 · 마감 전). 아니면 api-error로 던진다.
  private assertPayableReservation(
    reservation: Reservation | null,
    userId: number,
  ): asserts reservation is Reservation {
    if (!reservation) {
      throw this.reservationNotFound();
    }
    if (reservation.userId !== userId) {
      throw this.notOwner();
    }
    if (reservation.status !== ReservationStatus.PENDING_PAYMENT) {
      throw apiRpcException({
        status: 409,
        code: 'INVALID_RESERVATION_STATUS',
        message: '결제할 수 없는 예약 상태입니다.',
        retryable: false,
      });
    }
    if (Date.now() > this.paymentDueAt(reservation).getTime()) {
      throw apiRpcException({
        status: 409,
        code: 'PAYMENT_DUE_EXPIRED',
        message: '결제 가능 시간이 지났습니다. 예약을 다시 진행해 주세요.',
        retryable: false,
      });
    }
  }

  // 이미 FAILED로 끝난 시도를 다시 승인 요청했을 때의 응답
  private failedAttemptResponse(
    reservation: Reservation,
    failureReason?: string,
  ): ConfirmPaymentResponse {
    const finished = reservation.status !== ReservationStatus.PENDING_PAYMENT;
    return {
      result: 'FAILED',
      retryable: !finished,
      code: failureReason || 'PAYMENT_DECLINED',
      message: finished
        ? '결제를 더 진행할 수 없는 예약입니다.'
        : '카드 승인이 거절되었습니다. 다른 결제수단으로 다시 시도해 주세요.',
    };
  }

  private async failAttempt(
    attempt: PaymentAttempt,
    reason: string,
  ): Promise<void> {
    await this.paymentAttemptRepository.update(
      { attemptId: attempt.attemptId, status: PaymentAttemptStatus.REQUESTED },
      { status: PaymentAttemptStatus.FAILED, failureReason: reason },
    );
  }

  // 재시도할 수 없는 결제 실패 → 예약 PAYMENT_FAILED (조건부) + 잡아둔 재고 반환
  private async failReservation(reservation: Reservation): Promise<void> {
    const { affected } = await this.reservationRepository.update(
      {
        reservationId: reservation.reservationId,
        status: ReservationStatus.PENDING_PAYMENT,
      },
      { status: ReservationStatus.PAYMENT_FAILED },
    );
    if (affected) {
      await this.releaseRoomAvailability(reservation, '결제 실패');
    }
  }

  // 예약이 잡아둔 날짜(체크인~체크아웃 전날)의 예약 수를 1씩 돌려준다 (남은 방 +1, 판매 중지 여부는 그대로).
  // 실패해도 예약 상태 변경은 이미 끝났으므로 요청을 실패시키지 않고 로그만 남긴다(재고 동기화는 별도로 복구 가능).
  private async releaseRoomAvailability(
    reservation: Reservation,
    reason: string,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.hotelService.releaseRoomAvailability({
          roomId: reservation.roomId,
          startDate: reservation.checkInDate,
          endDate: this.dayBefore(reservation.checkOutDate),
        }),
      );
    } catch (error) {
      this.logger.error(
        `예약(#${reservation.reservationId}) ${reason} 후 room_availabilities 복구 요청 실패`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // 결제 마감 시각. 이 컬럼이 생기기 전에 만든 예약(payment_due_at이 NULL)은 생성 시각 + 30분으로 본다.
  private paymentDueAt(reservation: Reservation): Date {
    return (
      reservation.paymentDueAt ??
      new Date(
        reservation.createdAt.getTime() + PAYMENT_DUE_MINUTES * 60 * 1000,
      )
    );
  }

  private orderName(reservationId: number): string {
    return `호텔 예약 #${reservationId}`;
  }

  private reservationNotFound(): RpcException {
    return apiRpcException({
      status: 404,
      code: 'RESERVATION_NOT_FOUND',
      message: '존재하지 않는 예약입니다.',
      retryable: false,
    });
  }

  private notOwner(): RpcException {
    return apiRpcException({
      status: 403,
      code: 'NOT_RESERVATION_OWNER',
      message: '본인의 예약만 결제할 수 있습니다.',
      retryable: false,
    });
  }

  // 목록 응답에 예약별 "가장 최근 결제 시도 상태"를 붙인다 (위키 API 명세 5.1 lastPaymentAttemptStatus).
  // 예약마다 따로 조회하지 않도록 한 번에 가져와서 예약별 최신 시도만 고른다.
  private async toGrpcResponsesWithLastAttempt(
    reservations: Reservation[],
  ): Promise<BookingGrpcResponse[]> {
    if (reservations.length === 0) {
      return [];
    }
    const attempts = await this.paymentAttemptRepository.find({
      where: { reservationId: In(reservations.map((r) => r.reservationId)) },
      order: { attemptId: 'DESC' },
    });
    const now = Date.now();
    const lastStatus = new Map<number, string>();
    for (const attempt of attempts) {
      if (!lastStatus.has(attempt.reservationId)) {
        lastStatus.set(
          attempt.reservationId,
          this.attemptStatusForResponse(attempt, now),
        );
      }
    }
    return reservations.map((reservation) =>
      this.toGrpcResponse(
        reservation,
        lastStatus.get(reservation.reservationId),
      ),
    );
  }

  // 응답에 내려 줄 결제 시도 상태 (LDP-67). DB 상태는 REQUESTED/SUCCEEDED/FAILED뿐이라, REQUESTED 중
  // "승인을 요청했지만 결과를 모르는" 시도만 CONFIRMING으로 구분해 준다 — 프론트는 이때만 결제 버튼을 막는다.
  //  - REQUESTED + 승인 요청 시각 없음        → REQUESTED (결제 준비만 함, 돈 안 빠짐)
  //  - REQUESTED + 승인 요청 후 10분 이내     → CONFIRMING (돈이 빠졌을 수도 있음)
  //  - REQUESTED + 승인 요청 후 10분 지남     → REQUESTED (확정되지 않아도 재결제 허용, CONFIRMING_MINUTES 참고)
  private attemptStatusForResponse(
    attempt: PaymentAttempt,
    now: number,
  ): string {
    if (
      attempt.status === PaymentAttemptStatus.REQUESTED &&
      attempt.confirmRequestedAt &&
      now - attempt.confirmRequestedAt.getTime() < CONFIRMING_MINUTES * 60_000
    ) {
      return 'CONFIRMING';
    }
    return attempt.status;
  }

  // 'YYYY-MM-DD' 문자열을 하루 전 날짜로 변환한다. date 컬럼은 시간 정보가 없으므로 UTC 기준으로
  // 계산해도 타임존에 따라 날짜가 밀리지 않는다.
  private dayBefore(dateStr: string): string {
    const date = new Date(dateStr);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  private toGrpcResponse(
    reservation: Reservation,
    lastPaymentAttemptStatus?: string,
  ): BookingGrpcResponse {
    return {
      reservationId: reservation.reservationId,
      userId: reservation.userId,
      roomId: reservation.roomId,
      hotelId: reservation.hotelId,
      checkInDate: reservation.checkInDate,
      checkOutDate: reservation.checkOutDate,
      guestCount: reservation.guestCount,
      totalAmount: reservation.totalAmount,
      status: reservation.status,
      paymentDueAt: reservation.paymentDueAt
        ? reservation.paymentDueAt.toISOString()
        : '',
      lastPaymentAttemptStatus: lastPaymentAttemptStatus ?? '',
    };
  }

  // 관리자 호텔 상세 페이지의 "호텔별 지표" 섹션용 집계. hotelId 스냅샷 컬럼 덕분에 이 서비스의
  // DB만으로 계산되고, hotel-service 호출은 필요 없다 (점유율의 분모인 "총 객실 수"는 프론트가
  // 이미 갖고 있는 hotel-service의 GetRooms 결과를 그대로 재사용한다 — 이 메서드는 분자만 반환).
  // date를 생략하면 서버 기준 오늘로 계산한다.
  // newReservationsToday는 오늘 생성된 예약 전체가 아니라 "오늘 생성되고 결제까지 확정된"(status=RESERVED)
  // 건만 센다 — PENDING_PAYMENT(결제 대기 중)는 아직 확정된 예약이 아니므로 제외.
  // cancellationsToday는 오늘 취소된(status=CANCELLED) 예약만 센다.
  async getHotelBookingStats(
    hotelId: number,
    date?: string,
  ): Promise<HotelBookingStatsGrpcResponse> {
    const targetDate = date || today();
    // TypeORM QueryBuilder는 'alias.property' 표현에서 엔티티의 TS 프로퍼티명(camelCase)을
    // 기대한다 (실제 DB 컬럼명인 snake_case가 아님) — Reservation 엔티티의 프로퍼티명을 그대로 사용.
    const base = () =>
      this.reservationRepository
        .createQueryBuilder('reservation')
        .where('reservation.hotelId = :hotelId', { hotelId });

    const [
      checkInsToday,
      checkOutsToday,
      occupiedRoomsToday,
      newReservationsToday,
      cancellationsToday,
      revenueResult,
    ] = await Promise.all([
      base()
        .andWhere('reservation.checkInDate = :targetDate', { targetDate })
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .getCount(),
      base()
        .andWhere('reservation.checkOutDate = :targetDate', { targetDate })
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .getCount(),
      base()
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .andWhere('reservation.checkInDate <= :targetDate', { targetDate })
        .andWhere('reservation.checkOutDate > :targetDate', { targetDate })
        .select('COUNT(DISTINCT reservation.roomId)', 'count')
        .getRawOne<{ count: string }>(),
      base()
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .andWhere('DATE(reservation.createdAt) = :targetDate', {
          targetDate,
        })
        .getCount(),
      base()
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.CANCELLED,
        })
        .andWhere('DATE(reservation.updatedAt) = :targetDate', {
          targetDate,
        })
        .getCount(),
      base()
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .andWhere('DATE(reservation.createdAt) = :targetDate', {
          targetDate,
        })
        .select('SUM(reservation.totalAmount)', 'sum')
        .getRawOne<{ sum: string | null }>(),
    ]);

    return {
      checkInsToday,
      checkOutsToday,
      occupiedRoomsToday: Number(
        (occupiedRoomsToday as { count: string })?.count ?? 0,
      ),
      newReservationsToday,
      cancellationsToday,
      revenueToday: Number((revenueResult as { sum: string | null })?.sum ?? 0),
    };
  }
}
