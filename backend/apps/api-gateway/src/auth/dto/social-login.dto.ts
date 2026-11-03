import { IsString, MaxLength, MinLength } from 'class-validator';

// 카카오 로그인 후 돌아온 화면이 보내는 값 (LDP-194)
export class SocialLoginDto {
  /**
   * 카카오가 돌아올 주소에 붙여 준 인가 코드
   * @example "abc123..."
   */
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  code: string;

  /**
   * 인가 화면 주소를 받을 때 함께 받은 state (돌아올 주소의 state와 같아야 함)
   * @example "9f2c..."
   */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  state: string;
}
