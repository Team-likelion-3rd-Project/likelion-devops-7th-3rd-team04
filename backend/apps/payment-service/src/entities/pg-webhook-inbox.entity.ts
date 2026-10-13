import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// PG(토스) 웹훅 "받은 편지함". 원본을 먼저 기록하고, 토스 조회 API로 재확인한 뒤 처리합니다.
// 우리 DB에 없는 결제에 대한 웹훅(가짜 포함)도 일단 기록해야 하므로 payments로의 FK는 없습니다.
@Entity('pg_webhook_inbox')
export class PgWebhookInbox {
  // BIGINT는 JS number 범위를 넘을 수 있어 TypeORM(mysql2)이 문자열로 돌려줍니다.
  @PrimaryGeneratedColumn({ name: 'inbox_id', type: 'bigint' })
  inboxId!: string;

  // 웹훅 추적 ID (UNIQUE) — 같은 웹훅이 여러 번 와도 1번만 기록됩니다.
  @Column({ name: 'pg_event_key', type: 'varchar', length: 255 })
  pgEventKey!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'json', nullable: true })
  headers!: Record<string, unknown> | null;

  // 원본 본문
  @Column({ type: 'json' })
  body!: Record<string, unknown>;

  @CreateDateColumn({ name: 'received_at', type: 'datetime', precision: 6 })
  receivedAt!: Date;

  @Column({
    name: 'processed_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  processedAt!: Date | null;
}
