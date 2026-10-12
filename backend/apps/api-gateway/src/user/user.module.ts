import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { getGrpcOptions } from '@app/common';
import { UserController } from './user.controller';

@Module({
  imports: [
    // user-service gRPC 클라이언트 등록
    ClientsModule.register([
      {
        name: 'USER_SERVICE', // DI(의존성 주입)에 사용될 토큰 명
        ...getGrpcOptions(
          'user', // user.proto의 package명
          'user.proto', // proto 파일명
          process.env.USER_SERVICE_HOST || 'localhost:3001', // user-service gRPC 주소
        ),
      },
      {
        // 회원 탈퇴(DELETE /api/users/me)는 프로필(user-service)과 자격증명/세션(auth-service)에
        // 걸쳐 있어, 그 조율을 이미 register 등에서 담당하는 auth-service에 위임합니다.
        name: 'AUTH_SERVICE',
        ...getGrpcOptions(
          'auth', // auth.proto의 package명
          'auth.proto', // proto 파일명
          process.env.AUTH_SERVICE_HOST || 'localhost:3006', // auth-service gRPC 주소
        ),
      },
    ]),
  ],
  controllers: [UserController],
})
export class UserModule {}
