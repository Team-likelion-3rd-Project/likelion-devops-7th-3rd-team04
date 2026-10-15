import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '@nestjs/microservices';
import {
  getGrpcOptions,
  HealthModule,
  createSqsClient,
  SQS_CLIENT,
} from '@app/common';
import { BookingServiceController } from './booking-service.controller';
import { BookingServiceService } from './booking-service.service';
import { ReservationFacilityService } from './reservation-facility.service';
import { PaymentResultConsumer } from './payment-result/payment-result.consumer';
import { Reservation } from './entities/reservation.entity';
import { ReservationFacility } from './entities/reservation-facility.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { PaymentResultInbox } from './entities/payment-result-inbox.entity';

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
        entities: [
          Reservation,
          ReservationFacility,
          PaymentAttempt,
          PaymentResultInbox,
        ],
        // 테이블 구조는 Flyway(backend/migrations)만 바꿉니다. true로 두면 TypeORM이
        // 재기동 때마다 엔티티에 맞춰 테이블을 고치면서 Flyway가 만든 FK를 지워버립니다.
        synchronize: false,
        logging: true, // SQL 실행 쿼리 로깅
      }),
    }),

    // 3. 엔티티 리포지토리 등록
    TypeOrmModule.forFeature([
      Reservation,
      ReservationFacility,
      PaymentAttempt,
      PaymentResultInbox,
    ]),

    // 4. hotel-service gRPC 클라이언트 등록 (예약 취소 시 예약 가능일 복구 요청,
    //    예약 생성 시 객실 예약 가능 여부 검증 및 가격 합산)
    // 5. payment-service gRPC 클라이언트 등록 (예약 취소 시 환불 요청 — RefundPayment).
    //    payment-service도 이 서비스를 호출하는 반대 방향 의존(getBookingById/ConfirmBooking)이
    //    있어 두 서비스가 서로를 gRPC로 호출하는 순환 의존 구조가 된다. docker-compose에서는
    //    이쪽 방향에 depends_on을 걸지 않는다(순환 depends_on은 compose가 허용하지 않음) —
    //    gRPC 클라이언트는 연결을 지연 생성/재시도하므로 시작 순서가 강제되지 않아도 된다.
    ClientsModule.register([
      {
        name: 'HOTEL_SERVICE',
        ...getGrpcOptions(
          'hotel',
          'hotel.proto',
          process.env.HOTEL_SERVICE_HOST || 'localhost:3002',
        ),
      },
      {
        name: 'PAYMENT_SERVICE',
        ...getGrpcOptions(
          'payment',
          'payment.proto',
          process.env.PAYMENT_SERVICE_HOST || 'localhost:3004',
        ),
      },
    ]),
  ],
  controllers: [BookingServiceController],
  providers: [
    BookingServiceService,
    ReservationFacilityService,
    // 결제 결과 이벤트 수신 (SQS FIFO / ElasticMQ -> payment_result_inbox, LDP-26)
    PaymentResultConsumer,
    { provide: SQS_CLIENT, useFactory: createSqsClient },
  ],
})
export class BookingServiceModule {}
