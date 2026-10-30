import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SocialProvider = 'KAKAO';

// 소셜 로그인 연결 (LDP-194, V15). 카카오 등 외부 계정 ↔ user-service의 User.id.
// 소셜로 가입한 회원은 Credential(비밀번호)이 없고 여기에만 있다. userId는 Credential과 같이 FK 없이 참조한다.
@Entity('social_accounts')
export class SocialAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column({ type: 'varchar', length: 20 })
  provider!: SocialProvider;

  @Column({ type: 'varchar', length: 100 })
  providerUserId!: string;

  // 가입 당시 외부 계정 이메일 (기록용)
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
