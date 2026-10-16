import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RoomImageDto } from './room-image.dto';

export class UpdateRoomDto {
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
   * 객실 타입별 보유 수량. 생략하면 기존 값 유지. 오늘 이후 이미 예약된 수보다 적게는 줄일 수 없다
   * @example 10
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

  /**
   * 객실 이미지 목록 (배열 순서 = 노출 순서, 0번째가 대표 이미지). 항상 전체 교체되므로
   * 기존 이미지를 유지하려면 그대로 포함해서 다시 보내야 한다.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomImageDto)
  images?: RoomImageDto[];
}
