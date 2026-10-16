import { Column, Entity, PrimaryColumn } from 'typeorm';

// 객실 타입별 날짜별 재고/판매 상태/가격 (V8부터 재고 구조).
//  - 남은 방 = rooms.total_count - booked_count
//  - 예약 가능 = 판매 중(isAvailable) && 남은 방 > 0
// 달력 행은 시드(scripts/seed.ts)가 채운다.
@Entity('room_availabilities')
export class RoomAvailability {
  @PrimaryColumn({ name: 'room_id' })
  roomId!: number;

  @PrimaryColumn({ type: 'date' })
  date!: string;

  @Column()
  price!: number;

  // 관리자 판매 중지 여부 (true = 판매 중). 예약·취소로는 바뀌지 않는다 — 예약 상태는 bookedCount로 센다.
  @Column({ name: 'is_available', default: true })
  isAvailable!: boolean;

  // 이 날짜에 예약된 수 (V8). 예약하면 +1, 취소·결제 실패로 풀리면 -1.
  @Column({ name: 'booked_count', default: 0 })
  bookedCount!: number;
}
