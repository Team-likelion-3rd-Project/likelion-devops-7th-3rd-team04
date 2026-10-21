import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from './entities/user.entity';

// 고객(users) 도메인 모듈. DeletedUser는 탈퇴 트랜잭션에서 QueryRunner로 직접 다루므로
// 리포지토리 등록은 불필요합니다(entity 등록은 루트 user-service.module.ts에서 함께 합니다).
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
