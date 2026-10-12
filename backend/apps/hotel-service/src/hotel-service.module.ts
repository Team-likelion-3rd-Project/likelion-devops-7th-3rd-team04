import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HotelServiceController } from './hotel-service.controller';
import { HotelServiceService } from './hotel-service.service';
import { RoomService } from './room.service';
import { FacilityService } from './facility.service';
import { Hotel } from './entities/hotel.entity';
import { Room } from './entities/room.entity';
import { RoomAvailability } from './entities/room-availability.entity';
import { RoomImage } from './entities/room-image.entity';
import { Facility } from './entities/facility.entity';
import { HealthModule } from '@app/common';

@Module({
  imports: [
    // GET /health 헬스체크 엔드포인트 (libs/common/src/health)
    HealthModule,
    // 1. .env 환경변수 로드 설정
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. TypeORM MariaDB 비동기 연결 설정
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mariadb',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USERNAME', 'root'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        // 🟢 nest-cli.json이 webpack: true로 번들링하므로, dist에는 개별 *.entity.js 파일이
        //    존재하지 않아 글롭(glob) 경로로는 엔티티를 찾지 못합니다. 클래스를 직접 등록합니다.
        entities: [Hotel, Room, RoomAvailability, RoomImage, Facility],
        synchronize: true, // ⚠️ 개발 환경(Dev)에서만 true 사용
        logging: true, // SQL 실행 쿼리 로깅
      }),
    }),

    // 3. 엔티티 리포지토리 등록
    TypeOrmModule.forFeature([
      Hotel,
      Room,
      RoomAvailability,
      RoomImage,
      Facility,
    ]),
  ],
  controllers: [HotelServiceController],
  providers: [HotelServiceService, RoomService, FacilityService],
})
export class HotelServiceModule {}
