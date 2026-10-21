import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '@nestjs/microservices';
import { JwtModule } from '@nestjs/jwt';
import {
  getGrpcOptions,
  RedisModule,
  HealthModule,
  mariaDbSslOptions,
} from '@app/common';
import { AuthServiceController } from './auth-service.controller';
import { AuthServiceService } from './auth-service.service';
import { Credential } from './entities/credential.entity';
import { AdminCredential } from './entities/admin-credential.entity';

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
        // 운영 RDS는 TLS 접속만 허용 — DB_SSL=true + DB_SSL_CA_PATH로 켠다 (LDP-101, 비우면 평문)
        ssl: mariaDbSslOptions('DB', (key) => configService.get<string>(key)),
        // 🟢 nest-cli.json이 webpack: true로 번들링하므로, dist에는 개별 *.entity.js 파일이
        //    존재하지 않아 글롭(glob) 경로로는 엔티티를 찾지 못합니다. 클래스를 직접 등록합니다.
        // Credential은 고객 자격증명, AdminCredential은 관리자 자격증명 (완전히 분리된 테이블)
        entities: [Credential, AdminCredential],
        // 테이블 구조는 Flyway(backend/migrations, V6)만 바꿉니다. true로 두면 Flyway보다 먼저 떠서
        // 테이블을 만들어 버려 Flyway가 "non-empty schema"로 멈춥니다(LDP-60).
        synchronize: false,
        logging: true, // SQL 실행 쿼리 로깅
      }),
    }),

    // 3. Credential/AdminCredential 엔티티 리포지토리 등록
    TypeOrmModule.forFeature([Credential, AdminCredential]),

    // 4. JwtModule은 옵션 없이 등록하고, sign() 호출 시마다 access/refresh용 secret과
    //    expiresIn을 각각 지정합니다 (AuthServiceService 참고).
    JwtModule.register({}),

    // 5. user-service gRPC 클라이언트 등록 (회원가입/로그인 시 프로필 생성·조회)
    ClientsModule.register([
      {
        name: 'USER_SERVICE',
        ...getGrpcOptions(
          'user',
          'user.proto',
          process.env.USER_SERVICE_HOST || 'localhost:3001',
        ),
      },
      // booking-service: 회원 탈퇴 전 이용 예정 예약 확인 (LDP-95)
      {
        name: 'BOOKING_SERVICE',
        ...getGrpcOptions(
          'booking',
          'booking.proto',
          process.env.BOOKING_SERVICE_HOST || 'localhost:3003',
        ),
      },
    ]),

    // 6. 리프레시 토큰 저장소 (로컬: docker-compose의 redis 컨테이너, 운영: AWS ElastiCache)
    RedisModule,
  ],
  controllers: [AuthServiceController],
  providers: [AuthServiceService],
})
export class AuthServiceModule {}
