import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 객실 종류 (디럭스 더블룸 등). V9(LDP-86)에서 테이블 이름을 rooms → room_types로 바꿨다 —
// 실제 호실(101호 등)은 RoomUnit(테이블 rooms)이다.
// 속성 이름 roomId는 REST·gRPC 필드 이름(roomId = 객실 종류 ID)과 맞추려고 그대로 두고, 컬럼만 room_type_id에 연결한다.
@Entity('room_types')
export class RoomType {
  @PrimaryGeneratedColumn({ name: 'room_type_id' })
  roomId!: number;

  @Column({ name: 'hotel_id' })
  hotelId!: number;

  @Column()
  name!: string;

  @Column()
  capacity!: number;

  // 보유 수량 — 같은 날짜에 이 수만큼 예약을 받는다 (V8). LDP-82부터 사용 가능한(ACTIVE) 호실 수와 같게 맞춘다.
  @Column({ name: 'total_count', default: 1 })
  totalCount!: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
