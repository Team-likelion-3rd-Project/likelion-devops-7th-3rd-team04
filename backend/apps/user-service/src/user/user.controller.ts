import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { UserService } from './user.service';

// proto의 UserService(고객 도메인)와 매핑됩니다. 관리자 도메인은 ../admin/admin.controller.ts가 따로 갖습니다.
@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  // auth-service가 회원가입 시 호출: 프로필 생성 (이메일 중복 시 에러)
  @GrpcMethod('UserService', 'CreateUser')
  async createUser(data: { email: string; name: string; phoneNumber: string }) {
    return this.userService.createUser(data);
  }

  // auth-service가 로그인 시 호출: 이메일로 프로필 조회 (미가입 이메일이면 에러)
  @GrpcMethod('UserService', 'GetUserByEmail')
  async getUserByEmail(data: { email: string }) {
    return this.userService.getUserByEmail(data.email);
  }

  // api-gateway가 관리자 전용 "전체 유저 목록 조회"(GET /users)에서 호출
  @GrpcMethod('UserService', 'GetUsers')
  async getUsers() {
    return this.userService.getUsers();
  }

  // api-gateway가 "내 정보 조회"(GET /users/me), 관리자 "특정 유저 조회"(GET /users/:userId)에서 호출
  @GrpcMethod('UserService', 'GetUserById')
  async getUserById(data: { id: number }) {
    return this.userService.getUserById(data.id);
  }

  // api-gateway가 "내 정보 수정"(PUT /users/me)에서 호출
  @GrpcMethod('UserService', 'UpdateUser')
  async updateUser(data: { id: number; name: string; phoneNumber: string }) {
    return this.userService.updateUser(data.id, {
      name: data.name,
      phoneNumber: data.phoneNumber,
    });
  }

  // auth-service가 "회원 탈퇴"(DELETE /api/users/me)에서 호출: users 레코드를 deleted_user 백업
  // 테이블로 옮긴 뒤 users 테이블에서 제거 (없으면 에러)
  // 회원가입 도중 실패 시 프로필 되돌리기 — auth-service 전용 (LDP-96)
  @GrpcMethod('UserService', 'CancelSignup')
  async cancelSignup(data: { id: number; email: string }) {
    return this.userService.cancelSignup(data.id, data.email);
  }

  @GrpcMethod('UserService', 'DeleteUser')
  async deleteUser(data: { id: number }) {
    return this.userService.deleteUser(data.id);
  }
}
