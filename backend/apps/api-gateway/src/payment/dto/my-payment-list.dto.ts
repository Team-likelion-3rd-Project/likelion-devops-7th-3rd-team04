import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// GET /api/payments/me 조건. 아무것도 주지 않으면 예전처럼 전체 목록 (부하 테스트 11-06 — 단계적으로 페이지 적용)
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
}
