import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { getGrpcOptions } from '@app/common';
import { PaymentController } from './payment.controller';

@Module({
  imports: [
    // payment-service gRPC 클라이언트 등록
    ClientsModule.register([
      {
        name: 'PAYMENT_SERVICE', // DI(의존성 주입)에 사용될 토큰 명
        ...getGrpcOptions(
          'payment', // payment.proto의 package명
          'payment.proto', // proto 파일명
          process.env.PAYMENT_SERVICE_HOST || 'localhost:3004', // payment-service gRPC 주소
        ),
      },
      // 관리자 결제 조회를 지점별로 거르는 데 예약의 지점을 본다 (LDP-178)
      {
        name: 'BOOKING_SERVICE',
        ...getGrpcOptions(
          'booking',
          'booking.proto',
          process.env.BOOKING_SERVICE_HOST || 'localhost:3003',
        ),
      },
    ]),
  ],
  controllers: [PaymentController],
})
export class PaymentModule {}
