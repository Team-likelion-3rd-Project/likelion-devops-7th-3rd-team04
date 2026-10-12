import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

// 관리자 자격증명(비밀번호 해시)만 소유합니다. 이메일/이름 등 프로필은 user-service의 Admin이 소유합니다.
// Credential(고객용)과 테이블을 분리해 고객/관리자 로그인 경로를 완전히 독립적으로 유지합니다.
// adminId는 user-service의 Admin.id를 gRPC로 참조하는 값이며, DB 레벨의 FK는 걸지 않습니다(서비스 간 DB 분리).
@Entity('admin_credentials')
export class AdminCredential {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  adminId!: number;

  // 실수로 직렬화/로깅되어 외부에 노출되는 사고를 막기 위한 방어용 데코레이터
  @Exclude()
  @Column()
  passwordHash!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
