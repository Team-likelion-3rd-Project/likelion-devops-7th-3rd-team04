import { PaymentRecordBaseResponseDto } from './payment-record-response.dto';

// POST /payments 응답. 생성 직후는 항상 READY 상태라 승인/취소 관련 필드가 존재하지
// 않으므로 base 그대로 사용합니다.
export class CreatePaymentResponseDto extends PaymentRecordBaseResponseDto {}
