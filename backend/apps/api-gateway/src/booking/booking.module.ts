import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { getGrpcOptions } from '@app/common';
import { BookingController } from './booking.controller';
import { AdminBookingController } from './admin-booking.controller';

@Module({
  imports: [
    // booking-service gRPC 클라이언트 등록
    ClientsModule.register([
      {
        name: 'BOOKING_SERVICE', // DI(의존성 주입)에 사용될 토큰 명
        ...getGrpcOptions(
          'booking', // booking.proto의 package명
          'booking.proto', // proto 파일명
          process.env.BOOKING_SERVICE_HOST || 'localhost:3003', // booking-service gRPC 주소
        ),
      },
      // 관리자 대리 예약의 회원 존재 확인·직원 이름 조회 (LDP-90)
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
  controllers: [BookingController, AdminBookingController],
})
export class BookingModule {}
