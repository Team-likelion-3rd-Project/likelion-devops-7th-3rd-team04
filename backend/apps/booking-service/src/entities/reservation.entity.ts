import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReservationStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT', // 결제 대기 (예약 생성 시 기본값, 아직 결제 전)
  RESERVED = 'RESERVED', // 결제 완료, 예약 확정
  CANCELLED = 'CANCELLED', // 예약 취소
  COMPLETED = 'COMPLETED', // 체크아웃 완료
}

// 서비스 간 DB가 분리되어 있으므로 userId/roomId는 @ManyToOne 관계가 아니라
// 순수 정수 컬럼으로만 저장한다 (hotel-service의 Room.hotelId와 동일한 원칙).
@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn()
  reservationId!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  @Column({ name: 'room_id' })
  roomId!: number;

  // hotel-service의 Room.hotelId 스냅샷. 예약 생성 시점의 값을 그대로 복사해서 저장한다
  // (totalAmount/reservation_facilities.facilityName과 같은 스냅샷 원칙) — 호텔별 집계(대시보드
  // 지표 등)를 hotel-service 호출 없이 이 테이블만으로 계산하기 위함. nullable인 이유는 이 컬럼
  // 추가 이전에 생성된 기존 예약에는 값이 없기 때문.
  @Column({ name: 'hotel_id', nullable: true })
  hotelId?: number;

  @Column({ name: 'check_in_date', type: 'date' })
  checkInDate!: string;

  @Column({ name: 'check_out_date', type: 'date' })
  checkOutDate!: string;

  @Column({ name: 'guest_count' })
  guestCount!: number;

  @Column({ name: 'total_amount' })
  totalAmount!: number;

  @Column({
    type: 'enum',
    enum: ReservationStatus,
    default: ReservationStatus.PENDING_PAYMENT,
  })
  status!: ReservationStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
