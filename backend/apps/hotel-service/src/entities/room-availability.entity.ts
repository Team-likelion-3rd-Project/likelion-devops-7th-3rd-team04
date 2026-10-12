import { Column, Entity, PrimaryColumn } from 'typeorm';

// 객실별 날짜별 예약 가능 여부/가격 관리 테이블.
// 이 엔티티를 채우는 API는 별도 작업에서 구현 예정 — 지금은 스키마만 생성.
@Entity('room_availabilities')
export class RoomAvailability {
  @PrimaryColumn({ name: 'room_id' })
  roomId!: number;

  @PrimaryColumn({ type: 'date' })
  date!: string;

  @Column()
  price!: number;

  @Column({ name: 'is_available', default: true })
  isAvailable!: boolean;
}
