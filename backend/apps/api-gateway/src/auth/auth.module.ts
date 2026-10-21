import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { PassportModule } from '@nestjs/passport';
import { getGrpcOptions, JwtStrategy } from '@app/common';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    // JwtAuthGuard(@UseGuards(JwtAuthGuard))가 사용하는 'jwt' passport 전략 등록
    PassportModule,

    // auth-service gRPC 클라이언트 등록
    ClientsModule.register([
      {
        name: 'AUTH_SERVICE', // DI(의존성 주입)에 사용될 토큰 명
        ...getGrpcOptions(
          'auth', // auth.proto의 package명
          'auth.proto', // proto 파일명
          process.env.AUTH_SERVICE_HOST || 'localhost:3006', // auth-service gRPC 주소
        ),
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy],
})
export class AuthModule {}
