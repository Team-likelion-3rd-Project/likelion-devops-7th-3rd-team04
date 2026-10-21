import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  /**
   * 현재 비밀번호 (본인 확인용)
   * @example "password123"
   */
  @IsString()
  @MinLength(1, { message: '현재 비밀번호를 입력해주세요.' })
  currentPassword: string;

  /**
   * 새 비밀번호 (8자 이상 72자 이하)
   * @example "newPassword456"
   */
  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 합니다.' })
  @MaxLength(72, { message: '비밀번호는 72자 이하여야 합니다.' }) // bcrypt는 72바이트를 초과하는 입력을 자릅니다.
  newPassword: string;
}
