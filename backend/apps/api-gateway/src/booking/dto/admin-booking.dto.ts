import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { CreateBookingDto } from './create-booking.dto';

export class AdminCreateBookingDto extends CreateBookingDto {
  /**
   * 예약할 회원 ID (예약은 회원만 가능)
   * @example 7
   */
  @IsInt()
  @Min(1)
  userId: number;
}

export class AdminCancelBookingDto {
  /**
   * 취소 사유 (1~255자, 자유 입력 — 손님 요청, 노쇼, 중복 예약 등)
   * @example "손님 전화 요청"
   */
  @IsString()
  @Matches(/\S/, { message: 'cancelReason을 입력해 주세요.' })
  @MaxLength(255)
  cancelReason: string;
}

export class CreateExtensionBookingDto {
  /**
   * 새 체크아웃 날짜 (연장할 예약의 체크아웃보다 뒤)
   * @example "2026-11-05"
   */
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'checkOutDate는 YYYY-MM-DD 형식이어야 합니다.',
  })
  checkOutDate: string;

  @ApiPropertyOptional({
    description:
      '연장할 예약의 호실이 연장 기간에 비어 있으면 같은 호실로 배정 (기본 true). 비어 있지 않으면 미배정',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  keepSameRoomUnit?: boolean;
}
