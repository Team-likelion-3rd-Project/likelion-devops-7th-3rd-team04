import { IsString, Matches } from 'class-validator';

export class RoomImageDto {
  /**
   * 저장소에 올린 사진 경로. POST /api/hotels/{hotelId}/rooms/{roomId}/images/upload-url 로 받은 objectKey를 그대로 보냅니다.
   * 기존 사진을 유지하려면 객실 조회 응답의 images[].objectKey를 다시 보냅니다.
   * @example "room-types/12/0f3c8a52-6c2e-4b8f-9d1a-2f7e5b3c9a10.jpg"
   */
  @IsString()
  @Matches(/^room-types\/\d+\/[\w.-]+$/, {
    message: '객실 사진 경로가 아닙니다.',
  })
  objectKey: string;
}
