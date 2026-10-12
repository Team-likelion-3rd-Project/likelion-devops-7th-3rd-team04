import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshDto {
  /**
   * 로그인/회원가입 시 발급받은 리프레시 토큰
   * @example "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   */
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
