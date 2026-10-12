import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  /**
   * 이메일 (로그인 ID로 사용)
   * @example "user@example.com"
   */
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  email: string;

  /**
   * 비밀번호
   * @example "password123"
   */
  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 합니다.' })
  @MaxLength(72, { message: '비밀번호는 72자 이하여야 합니다.' }) // bcrypt는 72바이트를 초과하는 입력을 자릅니다.
  password: string;
}
