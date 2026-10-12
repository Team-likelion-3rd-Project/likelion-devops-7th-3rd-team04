import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { AdminService } from './admin.service';

// proto의 AdminService(관리자 도메인)와 매핑됩니다. 고객 도메인은 ../user/user.controller.ts가 따로 갖습니다.
@Controller()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // 관리자 계정 생성 (이메일 중복 시 에러)
  @GrpcMethod('AdminService', 'CreateAdmin')
  async createAdmin(data: {
    email: string;
    name: string;
    department?: string;
    position?: string;
  }) {
    return this.adminService.createAdmin(data);
  }

  // auth-service가 관리자 로그인 시 호출: 이메일로 관리자 계정 조회 (미등록이면 에러)
  @GrpcMethod('AdminService', 'GetAdminByEmail')
  async getAdminByEmail(data: { email: string }) {
    return this.adminService.getAdminByEmail(data.email);
  }

  // 관리자 전체 목록 조회
  @GrpcMethod('AdminService', 'GetAdmins')
  async getAdmins() {
    return this.adminService.getAdmins();
  }

  // 관리자 단건 조회 (없으면 에러)
  @GrpcMethod('AdminService', 'GetAdminById')
  async getAdminById(data: { id: number }) {
    return this.adminService.getAdminById(data.id);
  }
}
