import { Type } from 'class-transformer';
import { IsDateString, IsInt, Min } from 'class-validator';

export class RoomSearchQueryDto {
  /**
   * 체크인 날짜 (포함)
   * @example "2026-09-01"
   */
  @IsDateString()
  checkIn: string;

  /**
   * 체크아웃 날짜 (제외 — 묵는 마지막 날은 체크아웃 전날)
   * @example "2026-09-03"
   */
  @IsDateString()
  checkOut: string;

  /**
   * 예약 인원수
   * @example 2
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  guests: number;
}
