import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 서비스 간 DB가 분리되어 있으므로 facilityId는 @ManyToOne 관계가 아니라 순수 정수 컬럼으로만
// 저장한다 (hotel-service의 Room.hotelId와 동일한 원칙).
@Entity('reservation_facilities')
export class ReservationFacility {
  @PrimaryGeneratedColumn()
  reservationFacilityId!: number;

  @Column({ name: 'reservation_id' })
  reservationId!: number;

  // references hotel-service's Facility.facilityId (no FK constraint)
  @Column({ name: 'facility_id' })
  facilityId!: number;

  // 예약 생성 시점의 시설명 스냅샷. hotel-service에서 나중에 이름이 바뀌거나 시설이 삭제돼도
  // 이 예약 건에 표시되는 이름은 구매 당시 그대로 유지된다 (totalAmount를 가격 스냅샷으로 저장하는
  // 것과 같은 이유). 조회 시 hotel-service를 다시 호출하지 않아도 되는 효과도 있다.
  @Column({ name: 'facility_name' })
  facilityName!: string;

  @Column({ name: 'guest_count' })
  guestCount!: number;

  @Column({ name: 'total_amount' })
  totalAmount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
