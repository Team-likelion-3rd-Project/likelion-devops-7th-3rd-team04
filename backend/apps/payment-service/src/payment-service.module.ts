import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import {
  createSqsClient,
  HealthModule,
  mariaDbSslOptions,
  SQS_CLIENT,
} from '@app/common';
import { PaymentServiceController } from './payment-service.controller';
import { PaymentServiceService } from './payment-service.service';
import { Payment } from './entities/payment.entity';
import { PaymentOutbox } from './entities/payment-outbox.entity';
import { PgWebhookInbox } from './entities/pg-webhook-inbox.entity';
import { PgMockClient } from './pg-mock/pg-mock.client';
import { TossPaymentsClient } from './pg/toss-payments.client';
import { OutboxPublisherService } from './outbox/outbox-publisher.service';
import { PaymentReconciliationService } from './reconciliation/payment-reconciliation.service';

@Module({
  imports: [
    // GET /health 헬스체크 엔드포인트 (libs/common/src/health)
    HealthModule,
    // 1. .env 환경변수 로드 설정
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. TypeORM MariaDB 비동기 연결 설정 — 메인 DB(DB_*)가 아니라 결제 전용 DB(PAYMENT_DB_*)에 접속합니다.
    //    ERD 위키 "결제 DB": 온프레미스는 메인 DB VM 안의 별도 DB, AWS는 별도 RDS. 계정도 따로 씁니다.
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mariadb',
        host: configService.getOrThrow<string>('PAYMENT_DB_HOST'),
        port: configService.get<number>('PAYMENT_DB_PORT', 3306),
        username: configService.getOrThrow<string>('PAYMENT_DB_USERNAME'),
        password: configService.getOrThrow<string>('PAYMENT_DB_PASSWORD'),
        database: configService.getOrThrow<string>('PAYMENT_DB_DATABASE'),
        // 운영 결제 RDS는 TLS 접속만 허용 — PAYMENT_DB_SSL=true + PAYMENT_DB_SSL_CA_PATH로 켠다 (LDP-101, 비우면 평문)
        ssl: mariaDbSslOptions('PAYMENT_DB', (key) =>
          configService.get<string>(key),
        ),
        // 🟢 nest-cli.json이 webpack: true로 번들링하므로, dist에는 개별 *.entity.js 파일이
        //    존재하지 않아 글롭(glob) 경로로는 엔티티를 찾지 못합니다. 클래스를 직접 등록합니다.
        entities: [Payment, PaymentOutbox, PgWebhookInbox],
        // 테이블 구조는 Flyway(apps/payment-service/migrations)만 바꿉니다. true로 두면 TypeORM이
        // 재기동 때마다 엔티티에 맞춰 테이블을 고치면서 Flyway가 만든 생성 컬럼/FK/인덱스를 지워버립니다.
        synchronize: false,
        logging: true, // SQL 실행 쿼리 로깅
      }),
    }),

    // 3. 엔티티 리포지토리 등록
    TypeOrmModule.forFeature([Payment, PaymentOutbox, PgWebhookInbox]),

    // 4. PG HTTP 호출용 (pg-mock-service, 토스페이먼츠 API)
    HttpModule,
  ],
  controllers: [PaymentServiceController],
  providers: [
    PaymentServiceService,
    PgMockClient,
    TossPaymentsClient,
    // 결제 결과 이벤트 발행 (payment_outbox → SQS FIFO / ElasticMQ, LDP-26)
    OutboxPublisherService,
    // 결제 대사 배치 — 결과 불명 결제 확정·환불 실패 재시도 (LDP-97)
    PaymentReconciliationService,
    { provide: SQS_CLIENT, useFactory: createSqsClient },
  ],
})
export class PaymentServiceModule {}
