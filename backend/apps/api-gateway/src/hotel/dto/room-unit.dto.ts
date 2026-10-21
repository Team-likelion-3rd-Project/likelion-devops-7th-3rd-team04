import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const ROOM_UNIT_STATUSES = ['ACTIVE', 'OUT_OF_SERVICE'] as const;
export type RoomUnitStatus = (typeof ROOM_UNIT_STATUSES)[number];

// 방 번호: 영문·숫자·하이픈 1~20자 ("201", "B101", "1201-A")
const ROOM_NUMBER_PATTERN = /^[0-9A-Za-z-]{1,20}$/;

export class CreateRoomUnitDto {
  /**
   * 방 번호 (같은 지점 안에서 중복 불가). 영문·숫자·하이픈 1~20자
   * @example "201"
   */
  @Matches(ROOM_NUMBER_PATTERN, {
    message: 'roomNumber는 영문·숫자·하이픈 1~20자여야 합니다.',
  })
  roomNumber: string;

  /**
   * 층 (생략하면 없음)
   * @example 2
   */
  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;
}

export class UpdateRoomUnitDto extends CreateRoomUnitDto {}

export class SetRoomUnitStatusDto {
  /**
   * ACTIVE(사용 중) 또는 OUT_OF_SERVICE(점검). 점검이면 객실 종류의 보유 수량이 1 줄어든다
   * @example "OUT_OF_SERVICE"
   */
  @IsIn(ROOM_UNIT_STATUSES)
  status: RoomUnitStatus;
}

export class RoomUnitListQueryDto {
  /**
   * 호실 상태로 거르기 (생략하면 전체)
   * @example "ACTIVE"
   */
  @IsOptional()
  @IsIn(ROOM_UNIT_STATUSES)
  status?: RoomUnitStatus;

  /**
   * 객실 종류 ID로 거르기 (생략하면 전체)
   * @example 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number;
}

export class UnitAssignmentQueryDto {
  /**
   * 조회 시작일 (포함)
   * @example "2026-11-01"
   */
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate는 YYYY-MM-DD 형식이어야 합니다.',
  })
  startDate: string;

  /**
   * 조회 종료일 (포함). 시작일부터 최대 31일
   * @example "2026-11-07"
   */
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate는 YYYY-MM-DD 형식이어야 합니다.',
  })
  endDate: string;

  /**
   * 객실 종류 ID로 거르기 (생략하면 전체)
   * @example 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number;
}
