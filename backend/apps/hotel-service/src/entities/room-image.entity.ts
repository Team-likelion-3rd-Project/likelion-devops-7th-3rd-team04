import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 객실별 이미지 목록. Base64로 인코딩된 이미지 데이터를 DB 컬럼에 직접 저장한다
// (별도 오브젝트 스토리지(S3 등) 인프라가 아직 없어 임시로 채택한 방식).
// sortOrder가 0인 이미지가 대표(썸네일) 이미지다.
@Entity('room_images')
export class RoomImage {
  @PrimaryGeneratedColumn()
  imageId!: number;

  // 객실 종류 (room_types.room_type_id). 속성 이름은 API(roomId)와 맞춰 그대로 둔다 (V9에서 컬럼 이름만 변경)
  @Column({ name: 'room_type_id' })
  roomId!: number;

  @Column({ name: 'mime_type' })
  mimeType!: string;

  // data: 접두사를 제외한 순수 Base64 문자열
  @Column({ name: 'image_base64', type: 'longtext' })
  imageBase64!: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
