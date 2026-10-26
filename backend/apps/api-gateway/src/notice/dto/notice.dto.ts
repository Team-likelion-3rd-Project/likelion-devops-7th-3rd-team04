import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const NOTICE_CATEGORIES = ['NOTICE', 'EVENT', 'MAINTENANCE'] as const;

// 앞뒤 공백을 지운다 — 공백만 있는 제목·본문은 MinLength(1)에 걸린다
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// POST /api/notices, PUT /api/notices/{id} — 수정도 모든 칸을 함께 보낸다 (LDP-147)
export class NoticeBodyDto {
  /**
   * 제목 (1~200자)
   * @example "예약 시스템 점검 안내 (10월 12일 02:00~04:00)"
   */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  /**
   * 본문 (1~10,000자, 일반 텍스트 — 화면은 HTML로 해석하지 않고 줄바꿈만 살린다)
   * @example "더 안정적인 서비스를 위해 시스템 점검을 진행합니다."
   */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body: string;

  /**
   * 분류 — NOTICE(안내) | EVENT(이벤트) | MAINTENANCE(점검)
   * @example "MAINTENANCE"
   */
  @IsIn(NOTICE_CATEGORIES)
  category: (typeof NOTICE_CATEGORIES)[number];

  /**
   * 중요 공지 — 목록 맨 위에 고정 (생략하면 false)
   * @example false
   */
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

// GET /api/notices — 생략하면 전체
export class NoticeListQueryDto {
  /**
   * 페이지 (1부터). 생략하면 전체
   * @example 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * 한 페이지 개수 (기본 20, 최대 100). 메인 "새로운 소식"은 page=1&size=3
   * @example 3
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
