import type { AdminRole } from '@app/common';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 관리자 프로필 정보만 소유합니다(고객 User와 완전히 분리된 테이블). 비밀번호 등 자격증명은
// auth-service의 AdminCredential이 별도로 소유합니다. 고객처럼 자체 가입(signup) 플로우가 없고
// 다른 관리자(또는 초기 시드)가 생성하므로 role/status 컬럼은 두지 않았습니다 — 이 테이블에 있다는
// 사실 자체가 "관리자"임을 의미합니다.
@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  email!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  department?: string;

  @Column({ nullable: true })
  position?: string;

  // 소속 지점 (LDP-176, V13). null = 본사 — hotels는 hotel-service 소유라 FK 없음
  @Column({ type: 'int', nullable: true })
  hotelId!: number | null;

  // 직급 (LDP-176). 본사(SUPER)만 hotelId가 null
  @Column({
    type: 'enum',
    enum: ['SUPER', 'MANAGER', 'STAFF'],
    default: 'STAFF',
  })
  adminRole!: AdminRole;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
