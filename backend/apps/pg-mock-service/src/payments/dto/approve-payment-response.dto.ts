import { ApiProperty } from '@nestjs/swagger';
import { PaymentRecordBaseResponseDto } from './payment-record-response.dto';

// POST /payments/:paymentKey/approve 응답. 승인 성공 시 발급되는 필드만 추가하고,
// 취소 관련 필드(canceledAt, cancelReason)는 이 시점에 존재할 수 없으므로 넣지 않습니다.
export class ApprovePaymentResponseDto extends PaymentRecordBaseResponseDto {
  @ApiProperty({
    description: '카드사 승인번호 성격의 값',
    example: '12345678',
  })
  approvalNumber!: string;

  @ApiProperty({
    description: '승인 시각',
    example: '2026-08-18T02:00:05.000Z',
  })
  approvedAt!: string;
}
