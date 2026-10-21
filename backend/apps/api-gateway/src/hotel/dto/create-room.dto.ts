import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRoomDto {
  /**
   * 객실명
   * @example "디럭스 더블룸"
   */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  /**
   * 최대 인원
   * @example 2
   */
  @IsInt()
  @Min(1)
  capacity: number;

  /**
   * (무시됨, LDP-89) 보유 수량은 ACTIVE 호실 수로 자동 계산된다 — 호실 추가·점검 API로 바꾼다.
   * 기존 화면이 보내도 400이 나지 않도록 필드만 남겨 둔다.
   * @deprecated
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  totalCount?: number;

  /**
   * 객실 설명
   * @example "시티뷰를 갖춘 넓은 더블룸입니다."
   */
  @IsOptional()
  @IsString()
  description?: string;

  // 사진은 저장 경로에 객실 id가 들어가서(LDP-88) 등록할 때는 받지 않는다.
  // 등록 후 POST /api/hotels/{hotelId}/rooms/{roomId}/images/upload-url → 객실 수정(images)으로 붙인다.
}
