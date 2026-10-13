import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Payment } from './payment.entity';

// booking-service로 보낼 결제 결과 이벤트 종류.
export enum PaymentOutboxEventType {
  PAYMENT_APPROVED = 'PAYMENT_APPROVED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_REFUNDED = 'PAYMENT_REFUNDED',
  PAYMENT_REFUND_FAILED = 'PAYMENT_REFUND_FAILED',
}

// 결제 결과 이벤트 "보낼 편지함" (Transactional Outbox).
// 결제 상태를 바꾸는 트랜잭션 안에서 같이 INSERT 해서, 상태는 바뀌었는데 이벤트가 유실되는 일을 막습니다.
// 발행기가 미발행 행(publishedAt = NULL)을 SQS FIFO로 보낸 뒤 publishedAt을 기록합니다.
@Entity('payment_outbox')
export class PaymentOutbox {
  // UUID. SQS FIFO의 중복 제거 ID(MessageDeduplicationId)로 그대로 씁니다.
  @PrimaryColumn({ name: 'event_id', type: 'char', length: 36 })
  eventId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: PaymentOutboxEventType;

  // SQS FIFO 그룹 ID. 같은 예약의 이벤트는 순서대로 처리됩니다.
  // 예약은 다른 서비스(booking) 소유라 FK 없이 정수로만 저장합니다.
  @Column({ name: 'reservation_id' })
  reservationId!: number;

  @Column({ name: 'payment_id' })
  paymentId!: number;

  // 같은 결제 DB 안의 payments를 가리키는 FK (fk_payment_outbox_payment, ON DELETE RESTRICT).
  @ManyToOne(() => Payment, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Payment;

  @Column({ type: 'json' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;

  @Column({
    name: 'published_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  publishedAt!: Date | null;
}
