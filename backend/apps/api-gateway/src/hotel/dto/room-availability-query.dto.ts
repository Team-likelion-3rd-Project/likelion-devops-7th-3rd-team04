import { IsDateString } from 'class-validator';

export class RoomAvailabilityQueryDto {
  /**
   * 조회 시작일 (포함)
   * @example "2026-08-20"
   */
  @IsDateString()
  startDate: string;

  /**
   * 조회 종료일 (포함)
   * @example "2026-08-22"
   */
  @IsDateString()
  endDate: string;
}
