import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { getGrpcOptions } from '@app/common';
import { HotelController } from './hotel.controller';
import { RoomUnitController } from './room-unit.controller';

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
      // 호실 관리(RoomUnitController)가 점검 전 배정 확인·배정 현황에 쓴다 (LDP-89)
      {
        name: 'BOOKING_SERVICE',
        ...getGrpcOptions(
          'booking',
          'booking.proto',
          process.env.BOOKING_SERVICE_HOST || 'localhost:3003',
        ),
      },
      // 배정 현황의 예약자 이름(guestName) 조회 (LDP-89)
      {
        name: 'USER_SERVICE',
        ...getGrpcOptions(
          'user',
          'user.proto',
          process.env.USER_SERVICE_HOST || 'localhost:3001',
        ),
      },
    ]),
  ],
  controllers: [HotelController, RoomUnitController],
})
export class HotelModule {}
