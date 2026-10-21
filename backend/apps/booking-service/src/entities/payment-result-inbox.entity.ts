import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum PaymentResultEventType {
  PAYMENT_APPROVED = 'PAYMENT_APPROVED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_REFUNDED = 'PAYMENT_REFUNDED',
  PAYMENT_REFUND_FAILED = 'PAYMENT_REFUND_FAILED',
}

// payment-service가 SQS FIFO(payment_outbox)로 발행한 결제 결과 이벤트를 받아 적는 Inbox.
// event_id가 UNIQUE라 같은 이벤트가 중복으로 와도 한 번만 반영된다(Inbox 패턴).
@Entity('payment_result_inbox')
export class PaymentResultInbox {
  @PrimaryGeneratedColumn({ name: 'inbox_id', type: 'bigint' })
  inboxId!: string;

  // payment-service의 payment_outbox.event_id와 같은 값.
  @Column({ name: 'event_id', type: 'char', length: 36, unique: true })
  eventId!: string;

  @Column({ name: 'event_type', type: 'enum', enum: PaymentResultEventType })
  eventType!: PaymentResultEventType;

  @Column({ name: 'reservation_id' })
  reservationId!: number;

  // 환불 이벤트는 특정 시도와 연결되지 않아 비어 있을 수 있다.
  @Column({ name: 'attempt_id', type: 'bigint', nullable: true })
  attemptId?: string;

  // 결제 DB의 payments.paymentId를 가리킨다 — 서비스 경계를 넘는 참조라 FK는 걸지 않는다.
  @Column({ name: 'payment_id' })
  paymentId!: number;

  // SQS 메시지 원본
  @Column({ type: 'json' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'received_at' })
  receivedAt!: Date;

  // NULL이면 아직 처리 안 됨
  @Column({ name: 'processed_at', type: 'datetime', nullable: true })
  processedAt?: Date;
}
