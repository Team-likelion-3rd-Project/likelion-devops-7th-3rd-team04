import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive, IsString, MinLength } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({
    description: '가맹점(백엔드) 측 주문 ID',
    example: 'order_20260818_0001',
  })
  @IsString()
  @MinLength(1)
  orderId!: string;

  @ApiProperty({ description: '결제 금액(원)', example: 50000 })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({ description: '주문명', example: '더블룸 1박' })
  @IsString()
  @MinLength(1)
  orderName!: string;

  @ApiProperty({
    description:
      '결제수단. 값 검증은 하지 않고 그대로 저장했다가 승인 응답/웹훅에 그대로 실어 돌려줍니다 (실제로는 결제창에서 사용자가 선택하는 값).',
    example: 'CARD',
  })
  @IsString()
  @MinLength(1)
  paymentMethod!: string;
}
