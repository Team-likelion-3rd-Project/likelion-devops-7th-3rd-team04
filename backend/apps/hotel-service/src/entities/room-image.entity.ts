import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 객실별 이미지 목록. 사진 파일은 저장소(dev MinIO · prod S3)에 두고, DB에는 경로(object_key)만 저장한다
// (LDP-88, V10 — 그 전에는 image_base64 컬럼에 사진 자체를 넣었다). 버킷이 비공개라 화면에는
// object_key로 만든 Presigned URL을 내려준다 (RoomImageStorage).
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

  // 저장소 안 경로 (예: room-types/12/0f3c....jpg). 주소(엔드포인트)는 환경마다 달라서 넣지 않는다.
  @Column({ name: 'object_key', length: 512 })
  objectKey!: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
