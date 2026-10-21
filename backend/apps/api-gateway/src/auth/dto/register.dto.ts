import {
  IsEmail,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  /**
   * 이메일 (로그인 ID로 사용)
   * @example "user@example.com"
   */
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  email: string;

  /**
   * 비밀번호 (8자 이상 72자 이하)
   * @example "password123"
   */
  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 합니다.' })
  @MaxLength(72, { message: '비밀번호는 72자 이하여야 합니다.' }) // bcrypt는 72바이트를 초과하는 입력을 자릅니다.
  password: string;

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
