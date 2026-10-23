import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// GET /api/users 조건 (LDP-136). 아무것도 주지 않으면 예전처럼 전체 목록.
export class UserListQueryDto {
  /**
   * 페이지 (1부터). 생략하면 페이지를 나누지 않고 전체
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
   * 이름·이메일·연락처에 들어 있는 글자
   * @example "홍길동"
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}
