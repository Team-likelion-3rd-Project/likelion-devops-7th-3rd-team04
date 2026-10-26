import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserServiceController } from './user-service.controller';
import { UserServiceService } from './user-service.service';
import { UserModule } from './user/user.module';
import { AdminModule } from './admin/admin.module';
import { User } from './user/entities/user.entity';
import { DeletedUser } from './user/entities/deleted-user.entity';
import { Admin } from './admin/entities/admin.entity';
import {
  HealthModule,
  mariaDbSslOptions,
  typeOrmLoggingOptions,
} from '@app/common';

// 루트 모듈은 DB 커넥션 설정과 도메인 모듈(UserModule/AdminModule) 조립만 담당합니다.
// 실제 고객/관리자 도메인 로직은 각 모듈 안에 캡슐화되어 있습니다.
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
        // users/deleted_user는 고객 도메인, admins는 관리자 도메인 소유지만, 같은 서비스가
        // 같은 DB 커넥션을 쓰므로 연결 설정 자체는 루트에서 한 번만 합니다.
        entities: [User, DeletedUser, Admin],
        // 테이블 구조는 Flyway(backend/migrations, V6)만 바꿉니다. true로 두면 Flyway보다 먼저 떠서
        // 테이블을 만들어 버려 Flyway가 "non-empty schema"로 멈춥니다(LDP-60).
        synchronize: false,
        // 쿼리 로그는 값(PARAMETERS) 없이 — 실행 쿼리는 DB_LOGGING=true일 때만, 실패·느린 쿼리는 항상 (LDP-163)
        ...typeOrmLoggingOptions(),
      }),
    }),

    // 3. 도메인 모듈 조립 (각 모듈이 자신의 entity로 forFeature 리포지토리를 등록합니다)
    UserModule,
    AdminModule,
  ],
  controllers: [UserServiceController],
  providers: [UserServiceService],
})
export class UserServiceModule {}
