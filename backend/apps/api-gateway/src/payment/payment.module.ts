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
    ]),
  ],
  controllers: [PaymentController],
})
export class PaymentModule {}
