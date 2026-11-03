import { IsPhoneNumber, IsString, MaxLength, MinLength } from 'class-validator';

// 처음 온 카카오 회원의 추가 정보 입력 (LDP-194). 이메일은 카카오에서 받은 값을 서버가 그대로 쓴다
export class SocialSignupDto {
  /**
   * 카카오 로그인 응답의 가입 대기 토큰 (10분 동안 유효)
   * @example "Q2xhdWRl..."
   */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  signupToken: string;

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
