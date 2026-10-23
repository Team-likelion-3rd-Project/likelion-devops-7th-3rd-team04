import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 화면 표시: NOTICE = 안내, EVENT = 이벤트, MAINTENANCE = 점검
export enum NoticeCategory {
  NOTICE = 'NOTICE',
  EVENT = 'EVENT',
  MAINTENANCE = 'MAINTENANCE',
}

// 공지사항 (메인 V12 · LDP-147). 관리자가 작성·수정·삭제하고, 고객은 로그인 없이 본다.
@Entity('notices')
export class Notice {
  @PrimaryGeneratedColumn({ name: 'notice_id' })
  noticeId!: number;

  @Column({ length: 200 })
  title!: string;

  // 일반 텍스트 (화면은 HTML로 해석하지 않는다)
  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'enum', enum: NoticeCategory })
  category!: NoticeCategory;

  // 중요 공지 — 목록 맨 위에 고정 (MariaDB에서 boolean = TINYINT(1))
  @Column({ name: 'is_pinned', type: 'boolean', default: false })
  isPinned!: boolean;

  // 작성한 직원 (admins.adminId, 서비스 경계라 FK 없음). seed로 넣은 공지는 null
  @Column({ name: 'created_by_admin_id', type: 'int', nullable: true })
  createdByAdminId?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
