import { IsIn, IsInt, Max, Min } from 'class-validator';

export class CreateRoomImageUploadUrlDto {
  /**
   * 올릴 사진의 파일 형식 (JPG·PNG·WEBP)
   * @example "image/jpeg"
   */
  @IsIn(['image/jpeg', 'image/png', 'image/webp'], {
    message: 'JPG·PNG·WEBP 이미지만 올릴 수 있습니다.',
  })
  mimeType: string;

  /**
   * 파일 크기(byte), 5MB 이하. 업로드 URL에 서명되므로 실제로 올리는 파일 크기와 같아야 합니다.
   * @example 204800
   */
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024, { message: '이미지는 5MB 이하만 올릴 수 있습니다.' })
  size: number;
}
