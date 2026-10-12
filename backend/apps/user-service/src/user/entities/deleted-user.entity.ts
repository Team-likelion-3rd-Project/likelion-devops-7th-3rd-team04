import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole, UserStatus } from './user.entity';

// 회원 탈퇴(DELETE /api/users/me) 시 users 테이블의 레코드를 그대로 옮겨 담는 백업 테이블입니다.
// users 테이블에서는 실제로 하드 삭제되므로, 탈퇴한 유저의 데이터를 보존하는 유일한 위치입니다.
@Entity('deleted_user')
export class DeletedUser {
  @PrimaryGeneratedColumn()
  id!: number;

  // 탈퇴 전 users 테이블에서의 원본 PK (동일 이메일로 재가입 시 새 id가 발급되므로 이력 추적용으로 보존)
  @Column({ name: 'original_id' })
  originalId!: number;

  @Column()
  email!: string;

  @Column()
  name!: string;

  @Column({ name: 'phone_number' })
  phoneNumber!: string;

  @Column({ type: 'enum', enum: UserRole })
  role!: UserRole;

  @Column({ type: 'enum', enum: UserStatus })
  status!: UserStatus;

  // users 테이블에서의 원본 가입/수정 시각. @CreateDateColumn/@UpdateDateColumn을 쓰면 삽입 시각으로
  // 덮어써지므로, 원본 값을 그대로 보존하기 위해 일반 컬럼으로 복사합니다.
  @Column({ name: 'original_created_at', type: 'datetime' })
  originalCreatedAt!: Date;

  @Column({ name: 'original_updated_at', type: 'datetime' })
  originalUpdatedAt!: Date;

  // 백업(=탈퇴 처리)이 일어난 시각
  @CreateDateColumn({ name: 'deleted_at' })
  deletedAt!: Date;
}
