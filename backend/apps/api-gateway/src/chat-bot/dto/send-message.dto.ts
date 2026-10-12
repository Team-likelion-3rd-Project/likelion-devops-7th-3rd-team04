import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  /**
   * 사용자가 챗봇에게 보내는 메시지
   * @example "강남역 근처 호텔 추천해줘"
   */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;
}
