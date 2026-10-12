import { IsInt, IsString, MinLength } from 'class-validator';

// pg-mock-service(payments.service.ts의 sendWebhook)가 보내는 payload와 1:1 대응.
// signature는 HMAC 서명 검증에만 쓰이고, 검증 후 payment-service로는 넘기지 않는다.
export class PaymentWebhookDto {
  @IsString()
  @MinLength(1)
  eventType: string;

  @IsString()
  @MinLength(1)
  paymentKey: string;

  @IsString()
  @MinLength(1)
  orderId: string;

  @IsInt()
  amount: number;

  @IsString()
  @MinLength(1)
  paymentMethod: string;

  @IsString()
  @MinLength(1)
  approvalNumber: string;

  @IsString()
  @MinLength(1)
  status: string;

  @IsString()
  @MinLength(1)
  occurredAt: string;

  @IsString()
  @MinLength(1)
  signature: string;
}
