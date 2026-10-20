import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RoomUnitStatus {
  ACTIVE = 'ACTIVE', // 판매·배정 가능
  OUT_OF_SERVICE = 'OUT_OF_SERVICE', // 점검·수리 중 (보유 수량에서 빠짐)
}

// 실제 호실 (101호 등, V9 · LDP-86). 테이블 이름은 ERD대로 rooms이고, 객실 종류(RoomType)와 구분하려고
// 클래스 이름은 RoomUnit으로 둔다. 예약은 자동 배정하지 않고 직원이 나중에 배정한다
// (reservations.room_id = 이 테이블의 room_id, 서비스 경계라 FK 없음).
@Entity('rooms')
export class RoomUnit {
  @PrimaryGeneratedColumn({ name: 'room_id' })
  roomUnitId!: number;

  // 객실 종류 (room_types.room_type_id, FK)
  @Column({ name: 'room_type_id' })
  roomId!: number;

  // room_types.hotel_id와 같은 값. 같은 지점에 같은 방 번호를 막는 UNIQUE(hotel_id, room_number)에 쓴다.
  @Column({ name: 'hotel_id' })
  hotelId!: number;

  @Column({ name: 'room_number', length: 20 })
  roomNumber!: string;

  @Column({ type: 'int', nullable: true })
  floor?: number | null;

  @Column({
    type: 'enum',
    enum: RoomUnitStatus,
    default: RoomUnitStatus.ACTIVE,
  })
  status!: RoomUnitStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
