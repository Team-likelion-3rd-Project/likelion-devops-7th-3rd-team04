import { Controller, Get } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { UserServiceService } from './user-service.service';

// 도메인 로직이 없는 헬스체크 전용 컨트롤러입니다. 고객/관리자 도메인 로직은 각각
// ./user/user.controller.ts, ./admin/admin.controller.ts를 참고하세요.
@Controller()
export class UserServiceController {
  constructor(private readonly userServiceService: UserServiceService) {}

  // proto의 UserService / GetHello 메서드와 매핑
  @GrpcMethod('UserService', 'GetHello')
  getHello(): { message: string } {
    return { message: this.userServiceService.getHello() };
  }

  // DB 연결 확인 엔드포인트 (GET /db-check)
  @Get('db-check')
  async checkDb() {
    return await this.userServiceService.testConnection();
  }
}
