import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '../payment-record.interface';

// PaymentRecord(interface)는 컴파일 시 사라져서 @nestjs/swagger가 응답 스키마를 만들 수
// 없습니다. 아래 class들은 오직 Swagger 문서화(예시/스키마 표시)용이고, 실제 서비스 로직은
// 여전히 PaymentRecord 인터페이스를 그대로 씁니다 — 필드 구조가 같으므로 동작에는 영향 없습니다.
//
// 상태 전이마다 실제로 존재하는 필드가 달라서(READY: 기본 필드만 / DONE: +승인 관련 /
// CANCELED: +취소 관련) 이 base를 각 엔드포인트별 응답 DTO(create/approve/cancel)가
// extends해서 그 시점에 실제로 존재하는 필드만 노출합니다.
export class PaymentRecordBaseResponseDto {
  @ApiProperty({
    description: '결제 건 식별자 (PG가 발급)',
    example: 'pgmock_3f2a1b4c-5678-4d90-9abc-def012345678',
  })
  paymentKey!: string;

  @ApiProperty({
    description: '가맹점(백엔드) 측 주문 ID',
    example: 'order_20260818_0001',
  })
  orderId!: string;

  @ApiProperty({ description: '결제 금액(원)', example: 50000 })
  amount!: number;

  @ApiProperty({ description: '주문명', example: '더블룸 1박' })
  orderName!: string;

  @ApiProperty({ description: '결제수단', example: 'CARD' })
  paymentMethod!: string;

  @ApiProperty({
    description: '결제 상태',
    enum: ['READY', 'DONE', 'CANCELED'],
    example: 'READY',
  })
  status!: PaymentStatus;

  @ApiProperty({
    description: '결제 요청 생성 시각',
    example: '2026-08-18T02:00:00.000Z',
  })
  createdAt!: string;
}

// GET /payments/:paymentKey 전용. 조회 시점의 상태를 미리 알 수 없어(READY/DONE/CANCELED
// 어느 것이든 올 수 있음) 승인/취소 관련 필드를 전부 optional로 열어둡니다.
export class PaymentRecordResponseDto extends PaymentRecordBaseResponseDto {
  @ApiPropertyOptional({
    description: '카드사 승인번호 성격의 값. 승인(approve) 성공 시에만 존재',
    example: '12345678',
  })
  approvalNumber?: string;

  @ApiPropertyOptional({
    description: '승인 시각. 승인(approve) 성공 시에만 존재',
    example: '2026-08-18T02:00:05.000Z',
  })
  approvedAt?: string;

  @ApiPropertyOptional({
    description: '취소 시각. 취소(cancel) 성공 시에만 존재',
    example: '2026-08-18T03:00:00.000Z',
  })
  canceledAt?: string;

  @ApiPropertyOptional({ description: '취소 사유', example: '고객 변심' })
  cancelReason?: string;
}
