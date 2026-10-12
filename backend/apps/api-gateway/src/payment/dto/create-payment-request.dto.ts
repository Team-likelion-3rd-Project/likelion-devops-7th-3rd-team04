import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreatePaymentRequestDto {
  /**
   * 결제할 예약 PK ID
   * @example 1
   */
  @IsInt()
  @Min(1)
  reservationId: number;

  /**
   * 결제수단
   * @example "CARD"
   */
  @IsString()
  @MinLength(1)
  paymentMethod: string;
}
