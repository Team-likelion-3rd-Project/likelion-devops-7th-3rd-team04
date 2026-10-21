import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 결제 상태 7종 (ERD 위키 "결제 payments.status" 상태 모델).
//   PROCESSING -> APPROVED | FAILED | UNKNOWN(타임아웃, 토스 조회로 APPROVED/FAILED 확정)
//   APPROVED -> REFUND_REQUESTED -> REFUNDED | REFUND_FAILED(-> 재시도 성공 시 REFUNDED)
export enum PaymentStatus {
  PROCESSING = 'PROCESSING',
  APPROVED = 'APPROVED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  REFUND_FAILED = 'REFUND_FAILED',
  REFUNDED = 'REFUNDED',
}

// 어느 PG로 결제했는지. MOCK = pg-mock-service(부하테스트용), TOSS = 토스페이먼츠.
export enum PaymentProvider {
  MOCK = 'MOCK',
  TOSS = 'TOSS',
}

// 테이블 구조는 Flyway(apps/payment-service/migrations)가 관리합니다 — synchronize: false.
// 여기 선언은 실제 테이블과 맞춰 두기만 하고, 컬럼/인덱스를 바꾸려면 새 마이그레이션 파일을 추가하세요.
//
// 서비스 간 DB가 분리되어 있으므로 reservationId/userId는 @ManyToOne 관계가 아니라 순수 정수
// 컬럼으로만 저장한다 (booking-service의 Reservation.roomId와 동일한 원칙).
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn()
  paymentId!: number;

  @Column({ name: 'reservation_id' })
  reservationId!: number;

  // 결제 소유자. booking-service를 거치지 않고도 /me, /{userId} 조회를 처리할 수 있도록 저장해둔다.
  // 결제 승인 요청(ApprovePayment) 때 booking-service가 넘겨준 값이다 (결제 → 메인 조회 없음, LDP-102).
  @Column({ name: 'user_id' })
  userId!: number;

  // 같은 승인 요청이 재시도로 여러 번 와도 결제가 1건만 생기게 하는 키 (UNIQUE).
  @Column({ name: 'idempotency_key', type: 'char', length: 36 })
  idempotencyKey!: string;

  // PG에 보내는 주문번호 (토스 orderId).
  @Column({ name: 'pg_order_id', type: 'varchar', length: 64 })
  pgOrderId!: string;

  @Column({
    type: 'enum',
    enum: PaymentProvider,
    default: PaymentProvider.MOCK,
  })
  provider!: PaymentProvider;

  // 승인 전(PROCESSING)에는 아직 없으므로 NULL 가능.
  @Column({ name: 'approval_number', type: 'varchar', nullable: true })
  approvalNumber!: string | null;

  // PG가 발급한 결제 식별자 (UNIQUE). 환불(RefundPayment) 시 PG 취소 API(/payments/:paymentKey/cancel)
  // 호출에 필요해서 저장해둔다 — approvalNumber는 표시용, paymentKey는 PG 재호출용이라 역할이 다르다.
  // 승인 전에는 NULL.
  @Column({ name: 'payment_key', type: 'varchar', nullable: true })
  paymentKey!: string | null;

  @Column({ name: 'amount' })
  amount!: number;

  @Column({ name: 'payment_method' })
  paymentMethod!: string;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PROCESSING,
  })
  status!: PaymentStatus;

  // DB가 status를 보고 자동으로 계산하는 생성 컬럼(승인 이후 상태면 reservation_id, 아니면 NULL)입니다.
  // UNIQUE(uk_approved_reservation)가 걸려 있어 "예약당 승인 결제 1건"을 DB가 보장합니다.
  // 앱이 값을 쓰면 안 되므로 insert/update 대상에서 뺍니다 (읽기 전용).
  @Column({
    name: 'approved_reservation_id',
    type: 'int',
    nullable: true,
    insert: false,
    update: false,
  })
  approvedReservationId!: number | null;

  // 환불 요청이 재시도로 여러 번 와도 환불이 1번만 되게 하는 키 (UNIQUE).
  @Column({
    name: 'refund_idempotency_key',
    type: 'char',
    length: 36,
    nullable: true,
  })
  refundIdempotencyKey!: string | null;

  // PG 응답 원본 (장애 분석/대사용).
  @Column({ name: 'raw_response', type: 'json', nullable: true })
  rawResponse!: Record<string, unknown> | null;

  // 승인 시각. 승인 전에는 NULL.
  @Column({ name: 'paid_at', type: 'datetime', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'refunded_at', type: 'datetime', nullable: true })
  refundedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
