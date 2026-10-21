import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PaymentAttemptStatus {
  REQUESTED = 'REQUESTED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

// payment-service(결제 DB)를 호출할 때마다 남기는 결제 시도 기록. 같은 서비스(booking) 소유인
// reservations를 가리키므로 실제 FK를 건다(V4 마이그레이션 FK 6번).
@Entity('payment_attempts')
export class PaymentAttempt {
  // bigint PK는 JS Number 안전 범위를 넘을 수 있어 TypeORM이 string으로 다룬다.
  @PrimaryGeneratedColumn({ name: 'attempt_id', type: 'bigint' })
  attemptId!: string;

  @Column({ name: 'reservation_id' })
  reservationId!: number;

  // payment-service 호출 시 PrivateLink 헤더에 싣는 멱등 키. UNIQUE라 같은 시도가 두 번
  // INSERT되는 것을 DB가 막아준다.
  @Column({ name: 'idempotency_key', type: 'char', length: 36, unique: true })
  idempotencyKey!: string;

  // 시도마다 새로 발급하는 토스 주문번호 — 재시도해도 이전 시도와 충돌하지 않는다.
  @Column({ name: 'pg_order_id', unique: true })
  pgOrderId!: string;

  // 승인 요청 시 이 값과 payment-service가 아는 금액을 대조해 위변조를 거른다.
  @Column()
  amount!: number;

  @Column({
    type: 'enum',
    enum: PaymentAttemptStatus,
    default: PaymentAttemptStatus.REQUESTED,
  })
  status!: PaymentAttemptStatus;

  @Column({ name: 'failure_reason', nullable: true })
  failureReason?: string;

  // payment-service에 승인을 요청하기 직전에 기록하는 시각 (V7). 값이 있는데 아직 REQUESTED면
  // "승인을 요청했지만 결과를 모르는" 상태 — 예약 응답에서 CONFIRMING으로 내려 준다.
  // 비어 있으면 결제 준비만 하고 승인 요청은 안 보낸 시도다 (토스 결제창에서 닫기 등).
  @Column({ name: 'confirm_requested_at', type: 'datetime', nullable: true })
  confirmRequestedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
