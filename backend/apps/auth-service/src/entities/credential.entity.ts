import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

// 자격증명(비밀번호 해시)만 소유합니다. 이메일/이름 등 프로필은 user-service의 User가 소유합니다.
// userId는 user-service의 User.id를 gRPC로 참조하는 값이며, DB 레벨의 FK는 걸지 않습니다(서비스 간 DB 분리).
// 순수 TypeORM 도메인 모델로 유지합니다. Swagger 문서화는 api-gateway의 컨트롤러/DTO에서 담당합니다.
@Entity('credentials')
export class Credential {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  userId!: number;

  // 실수로 직렬화/로깅되어 외부에 노출되는 사고를 막기 위한 방어용 데코레이터
  @Exclude()
  @Column()
  passwordHash!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
