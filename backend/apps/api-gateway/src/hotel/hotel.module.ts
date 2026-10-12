import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { getGrpcOptions } from '@app/common';
import { HotelController } from './hotel.controller';

@Module({
  imports: [
    // hotel-service gRPC 클라이언트 등록
    ClientsModule.register([
      {
        name: 'HOTEL_SERVICE', // DI(의존성 주입)에 사용될 토큰 명
        ...getGrpcOptions(
          'hotel', // hotel.proto의 package명
          'hotel.proto', // proto 파일명
          process.env.HOTEL_SERVICE_HOST || 'localhost:3002', // hotel-service gRPC 주소
        ),
      },
    ]),
  ],
  controllers: [HotelController],
})
export class HotelModule {}
