import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
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

export const RESERVATION_STATUSES = [
  'PENDING_PAYMENT',
  'RESERVED',
  'PAYMENT_FAILED',
  'EXPIRED',
  'CANCELLED',
  'COMPLETED',
] as const;

// GET /api/bookings 조건 (LDP-136). 아무것도 주지 않으면 예전처럼 전체 목록.
export class AdminBookingListQueryDto {
  /**
   * 페이지 (1부터). 생략하면 페이지를 나누지 않고 조건에 맞는 전체
   * @example 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * 한 페이지 개수 (기본 20, 최대 100). page와 함께 쓴다
   * @example 20
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;

  /**
   * 지점 ID
   * @example 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hotelId?: number;

  @ApiPropertyOptional({
    type: String,
    description:
      '예약 상태, 쉼표로 여러 개 (예: 진행 중 = PENDING_PAYMENT,RESERVED)',
    example: 'PENDING_PAYMENT,RESERVED',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((status) => status.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsIn(RESERVATION_STATUSES, { each: true })
  status?: string[];

  /**
   * 검색어 — 예약번호(숫자) 또는 회원 이름·이메일·연락처 일부
   * @example "홍길동"
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  /**
   * 이 예약과 그 연장 예약만 (연장 묶음 보기)
   * @example 12
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  linkedTo?: number;
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
