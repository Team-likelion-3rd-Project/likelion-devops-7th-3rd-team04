import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn()
  roomId!: number;

  @Column({ name: 'hotel_id' })
  hotelId!: number;

  @Column()
  name!: string;

  @Column()
  capacity!: number;

  // 객실 타입별 보유 수량 (V8). rooms 한 줄 = 객실 타입 1개이고, 같은 날짜에 이 수만큼 예약을 받는다.
  @Column({ name: 'total_count', default: 1 })
  totalCount!: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
