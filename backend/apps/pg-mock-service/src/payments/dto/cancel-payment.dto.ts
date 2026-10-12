import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CancelPaymentDto {
  @ApiPropertyOptional({ description: '취소 사유', example: '고객 변심' })
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
