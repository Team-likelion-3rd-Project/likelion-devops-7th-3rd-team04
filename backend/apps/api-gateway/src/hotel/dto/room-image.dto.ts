import { IsString } from 'class-validator';

export class RoomImageDto {
  /**
   * 이미지 MIME 타입
   * @example "image/jpeg"
   */
  @IsString()
  mimeType: string;

  /**
   * Base64로 인코딩된 이미지 데이터 (data: 접두사를 제외한 순수 Base64 문자열)
   * @example "/9j/4AAQSkZJRgABAQAAAQABAAD..."
   */
  @IsString()
  imageBase64: string;
}
