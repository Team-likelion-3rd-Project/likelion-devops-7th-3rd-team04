import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RESERVATION_STATUSES } from './admin-booking.dto';

// GET /api/bookings/me 조건. 아무것도 주지 않으면 예전처럼 전체 목록 (부하 테스트 11-06 — 단계적으로 페이지 적용)
export class MyBookingListQueryDto {
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

  @ApiPropertyOptional({
    type: String,
    description:
      '예약 상태, 쉼표로 여러 개 (예: 결제 대기 = PENDING_PAYMENT, 취소 가능 = PENDING_PAYMENT,RESERVED)',
    example: 'PENDING_PAYMENT',
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
}
