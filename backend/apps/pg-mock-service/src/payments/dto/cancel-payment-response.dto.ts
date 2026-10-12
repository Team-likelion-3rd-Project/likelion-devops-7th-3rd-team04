import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovePaymentResponseDto } from './approve-payment-response.dto';

// POST /payments/:paymentKey/cancel 응답. 취소는 승인된(DONE) 건에만 가능하므로
// approve 응답 필드(승인번호/승인시각)를 그대로 물려받고, 취소 관련 필드를 추가합니다.
export class CancelPaymentResponseDto extends ApprovePaymentResponseDto {
  @ApiProperty({
    description: '취소 시각',
    example: '2026-08-18T03:00:00.000Z',
  })
  canceledAt!: string;

  @ApiPropertyOptional({ description: '취소 사유', example: '고객 변심' })
  cancelReason?: string;
}
