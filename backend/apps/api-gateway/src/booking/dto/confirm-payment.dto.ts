import { IsInt, IsString, Min, MinLength } from 'class-validator';

// POST /api/bookings/{reservationId}/payment-attempts/confirm 요청 본문 (위키 API 명세 5.9).
// 토스 결제창이 성공 URL에 붙여 준 값을 그대로 보낸다.
export class ConfirmPaymentDto {
  /**
   * 토스가 발급한 결제 키 (MOCK 모드: mock_{orderId}, 거절 재현: mock_fail_{orderId})
   * @example "tgen_20261015100003abcd"
   */
  @IsString()
  @MinLength(1)
  paymentKey: string;

  /**
   * 결제 준비(5.8)에서 받은 주문번호
   * @example "rsv1-9f2c4a7e1b3d"
   */
  @IsString()
  @MinLength(1)
  orderId: string;

  /**
   * 결제 준비(5.8)에서 받은 금액. 서버에 저장된 금액과 다르면 거절된다.
   * @example 400000
   */
  @IsInt()
  @Min(1)
  amount: number;
}
