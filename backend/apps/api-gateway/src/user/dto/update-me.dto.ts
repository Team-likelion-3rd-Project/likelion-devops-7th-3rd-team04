import { IsPhoneNumber, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMeDto {
  /**
   * 이름
   * @example "홍길동"
   */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  /**
   * 전화번호 (하이픈 포함/미포함 모두 허용)
   * @example "010-1234-5678"
   */
  @IsPhoneNumber('KR', { message: '올바른 휴대폰 번호 형식이 아닙니다.' })
  phoneNumber: string;
}
