import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { getGrpcOptions } from '@app/common';
import { NoticeController } from './notice.controller';

// 공지사항 API (LDP-147) — 공지는 hotel-service가 소유한다 (hotel.proto의 NoticeService)
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'HOTEL_SERVICE',
        ...getGrpcOptions(
          'hotel',
          'hotel.proto',
          process.env.HOTEL_SERVICE_HOST || 'localhost:3002',
        ),
      },
    ]),
  ],
  controllers: [NoticeController],
})
export class NoticeModule {}
