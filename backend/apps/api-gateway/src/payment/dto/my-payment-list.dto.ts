import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

// GET /api/payments/me 조건. 전체를 한 번에 돌려주지 않는다 (부하 테스트 11-06, list-page.ts)
export class MyPaymentListQueryDto {
  /**
   * 이 예약의 결제만 (실패·재시도 결제까지 여러 건일 수 있다 — 환불 상태 표시용)
   * @example 12
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  reservationId?: number;

  /**
   * 페이지 (1부터). 생략하면 최신순 앞쪽 size건(기본·최대 100) — 더 있는지는 total로 안다
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
}

// GET /api/payments/users/{userId} 조건 (관리자). 전체를 한 번에 돌려주지 않는다 (list-page.ts)
export class AdminUserPaymentListQueryDto {
  @ApiPropertyOptional({
    type: String,
    description:
      '이 예약들의 결제만, 쉼표로 여러 개 (최대 100개 — 관리자 예약 목록이 지금 페이지의 예약만 조회)',
    example: '12,15',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
          .map(Number)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  reservationIds?: number[];

  /**
   * 페이지 (1부터). 생략하면 최신순 앞쪽 size건(기본·최대 100) — 더 있는지는 total로 안다
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
}
