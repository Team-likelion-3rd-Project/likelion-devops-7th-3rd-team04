import { status as GrpcStatus } from '@grpc/grpc-js';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from './entities/admin.entity';
import { rpcError } from '@app/common';

// proto의 Admin 메시지와 1:1 대응되는 응답 형태
export interface AdminGrpcResponse {
  id: number;
  email: string;
  name: string;
  department?: string;
  position?: string;
}

// 관리자(admins) 도메인 전용 서비스입니다. 고객(users) 도메인은 ../user/user.service.ts가 별도로 소유합니다.
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Admin) private readonly adminRepository: Repository<Admin>,
  ) {}

  // 관리자 계정을 생성합니다. (초기 시드/다른 관리자가 호출) 이메일 중복 시 RpcException.
  async createAdmin(data: {
    email: string;
    name: string;
    department?: string;
    position?: string;
  }): Promise<AdminGrpcResponse> {
    const existing = await this.adminRepository.findOne({
      where: { email: data.email },
    });
    if (existing) {
      throw rpcError(
        GrpcStatus.ALREADY_EXISTS,
        '이미 등록된 관리자 이메일입니다.',
      );
    }

    const admin = this.adminRepository.create({
      email: data.email,
      name: data.name,
      department: data.department,
      position: data.position,
    });
    const saved = await this.adminRepository.save(admin);
    return this.toGrpcResponse(saved);
  }

  // auth-service가 관리자 로그인 시 이메일로 조회. 미등록 이메일이면 RpcException.
  async getAdminByEmail(email: string): Promise<AdminGrpcResponse> {
    const admin = await this.adminRepository.findOne({ where: { email } });
    if (!admin) {
      throw rpcError(
        GrpcStatus.NOT_FOUND,
        '등록되지 않은 관리자 이메일입니다.',
      );
    }
    return this.toGrpcResponse(admin);
  }

  // 관리자 전체 목록 조회.
  async getAdmins(): Promise<{ admins: AdminGrpcResponse[] }> {
    const admins = await this.adminRepository.find();
    return { admins: admins.map((admin) => this.toGrpcResponse(admin)) };
  }

  // 관리자 단건 조회. 없으면 RpcException.
  async getAdminById(id: number): Promise<AdminGrpcResponse> {
    const admin = await this.adminRepository.findOne({ where: { id } });
    if (!admin) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 관리자입니다.');
    }
    return this.toGrpcResponse(admin);
  }

  private toGrpcResponse(admin: Admin): AdminGrpcResponse {
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      department: admin.department,
      position: admin.position,
    };
  }
}
