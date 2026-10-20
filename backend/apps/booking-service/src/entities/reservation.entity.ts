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
  PAYMENT_FAILED = 'PAYMENT_FAILED', // 결제 재시도 불가(금액 위변조, 최대 시도 초과 등)로 확정 실패
  EXPIRED = 'EXPIRED', // payment_due_at까지 결제 안 돼서 배치가 만료 처리
  CANCELLED = 'CANCELLED', // 예약 취소
  COMPLETED = 'COMPLETED', // 체크아웃 완료
}

// 서비스 간 DB가 분리되어 있으므로 userId/roomId/roomUnitId는 @ManyToOne 관계가 아니라
// 순수 정수 컬럼으로만 저장한다 (hotel-service 소유 테이블이라 FK 없음).
// 속성 이름은 REST·gRPC 필드 이름과 맞춘다: roomId = 객실 종류(컬럼 room_type_id), roomUnitId = 배정 호실(컬럼 room_id) — V9.
@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn()
  reservationId!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  // 예약한 객실 종류 (room_types.room_type_id). V9에서 컬럼 이름만 room_id → room_type_id로 변경
  @Column({ name: 'room_type_id' })
  roomId!: number;

  // 배정된 호실 (rooms.room_id). 예약할 때는 비어 있고 직원이 나중에 배정한다 (V9 · LDP-82)
  @Column({ name: 'room_id', type: 'int', nullable: true })
  roomUnitId?: number | null;

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

  // 결제 대기 마감 시각(생성 + 30분). 만료 배치(LDP-26 이후)가 이 시각 지난 PENDING_PAYMENT
  // 예약을 EXPIRED로 돌린다. 생성 시 값 채우는 로직은 LDP-25(토스 승인 연동)에서 구현 — 지금은
  // 컬럼만 추가하는 단계라 nullable.
  @Column({ name: 'payment_due_at', type: 'datetime', nullable: true })
  paymentDueAt?: Date;

  // 연장 예약이면 원래 예약 (같은 테이블 자기 참조 FK, V9 · LDP-83)
  @Column({ name: 'linked_reservation_id', type: 'int', nullable: true })
  linkedReservationId?: number | null;

  // 대리 예약을 만든 직원 (admins.id 참조, FK 없음). NULL = 회원 본인 예약
  @Column({ name: 'created_by_admin_id', type: 'int', nullable: true })
  createdByAdminId?: number | null;

  // 만든 직원 이름 스냅샷 (직원 계정이 바뀌거나 삭제돼도 표시 유지)
  @Column({
    name: 'created_by_admin_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  createdByAdminName?: string | null;

  // 예약을 취소한 직원 (admins.id 참조, FK 없음). NULL = 손님 본인 취소·자동 만료·미취소
  @Column({ name: 'cancelled_by_admin_id', type: 'int', nullable: true })
  cancelledByAdminId?: number | null;

  // 직원 취소 사유
  @Column({
    name: 'cancel_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  cancelReason?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
