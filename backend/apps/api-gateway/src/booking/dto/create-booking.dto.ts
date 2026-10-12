import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class CreateBookingDto {
  /**
   * 예약할 객실 PK ID
   * @example 1
   */
  @IsInt()
  @Min(1)
  roomId: number;

  /**
   * 예약할 객실이 속한 호텔 PK ID. 편의시설(수영장/라운지) 요금을 조회하는 데에만 쓰이고
   * 예약(Reservation)에는 저장되지 않는다 (서비스 간 DB 분리 원칙 — roomId만 저장).
   * @example 1
   */
  @IsInt()
  @Min(1)
  hotelId: number;

  /**
   * 체크인 날짜 (해당 날짜부터 숙박)
   * @example "2026-08-16"
   */
  @IsDateString()
  checkInDate: string;

  /**
   * 체크아웃 날짜 (이 날짜 전날까지 숙박, 체크인 날짜보다 이후여야 함)
   * @example "2026-08-20"
   */
  @IsDateString()
  checkOutDate: string;

  /**
   * 투숙 인원수
   * @example 2
   */
  @IsInt()
  @Min(1)
  guestCount: number;

  /**
   * 실내 수영장 이용 인원수. 0 또는 미지정이면 미이용.
   * @example 0
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  poolGuestCount?: number;

  /**
   * 라운지 이용 인원수. 0 또는 미지정이면 미이용.
   * @example 0
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  loungeGuestCount?: number;
}
