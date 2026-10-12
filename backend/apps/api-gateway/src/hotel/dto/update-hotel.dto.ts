import {
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateHotelDto {
  /**
   * 호텔명
   * @example "르메르디앙 서울"
   */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  /**
   * 주소
   * @example "서울시 강남구 테헤란로 123"
   */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  address: string;

  /**
   * 대표 전화번호
   * @example "02-1234-5678"
   */
  @IsPhoneNumber('KR', { message: '올바른 전화번호 형식이 아닙니다.' })
  phoneNumber: string;

  /**
   * 호텔 설명
   * @example "도심 속 5성급 호텔입니다."
   */
  @IsOptional()
  @IsString()
  description?: string;
}
