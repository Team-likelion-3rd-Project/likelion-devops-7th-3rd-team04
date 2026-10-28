import { status as GrpcStatus } from '@grpc/grpc-js';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Like, Repository } from 'typeorm';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { DeletedUser } from './entities/deleted-user.entity';
import { rpcError } from '@app/common';

// proto의 User 메시지와 1:1 대응되는 응답 형태
export interface UserGrpcResponse {
  id: number;
  email: string;
  name: string;
  phoneNumber: string;
  role: string;
  status: string;
}

// 회원 목록 조건 (proto GetUsersRequest, LDP-136). 비어 있는 칸은 조건 없음
export interface UserListQuery {
  page?: number;
  size?: number;
  keyword?: string;
}

// 한 번에 찾을 수 있는 회원 수 (관리자 예약 목록 한 페이지 최대 100건 기준, LDP-150)
const MAX_USERS_BY_IDS = 100;

// LIKE 검색어의 %·_·\ 를 글자 그대로 찾게 한다
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

// 비밀번호 없이 남은 프로필을 정리해도 되는 최소 경과 시간 (LDP-111). 정상 가입은 프로필을 만든 직후(1초 안) 비밀번호를
// 저장하므로, 이보다 오래된 프로필은 가입 진행 중이 아니라 탈퇴·가입이 중간에 멈춘 것으로 본다.
export const ORPHAN_PROFILE_MIN_AGE_SECONDS = 5 * 60;

// 고객(users) 도메인 전용 서비스입니다. 관리자(admins) 도메인은 ../admin/admin.service.ts가 별도로 소유합니다.
@Injectable()
export class UserService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  // auth-service 회원가입 요청으로 프로필 생성. 이메일 중복 시 RpcException.
  async createUser(data: {
    email: string;
    name: string;
    phoneNumber: string;
  }): Promise<UserGrpcResponse> {
    const existing = await this.userRepository.findOne({
      where: { email: data.email },
    });
    if (existing) {
      throw rpcError(GrpcStatus.ALREADY_EXISTS, '이미 가입된 이메일입니다.');
    }

    const user = this.userRepository.create({
      email: data.email,
      name: data.name,
      phoneNumber: data.phoneNumber,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    });
    const saved = await this.userRepository.save(user);
    return this.toGrpcResponse(saved);
  }

  // auth-service 회원가입 되돌리기 (LDP-96). 비밀번호 저장에 실패해 가입이 성립하지 않았을 때, 방금 만든 프로필을
  // 지워서 같은 이메일로 다시 가입할 수 있게 합니다. 탈퇴가 아니므로 deleted_user 백업을 남기지 않습니다.
  // 다른 회원을 지우지 않도록 id와 email이 모두 맞을 때만 지우고, 이미 없으면 그대로 성공입니다.
  async cancelSignup(id: number, email: string): Promise<{ success: boolean }> {
    await this.userRepository.delete({ id, email });
    return { success: true };
  }

  // auth-service 회원가입 전 호출 (LDP-111). 탈퇴가 프로필 단계에서 멈추면 비밀번호·세션은 이미 지워져 로그인도
  // 탈퇴 재시도도 할 수 없고, 남은 프로필 때문에 같은 이메일로 재가입도 막힙니다. 그 프로필을 탈퇴와 똑같이
  // deleted_user로 옮긴 뒤 지웁니다. 비밀번호가 없는지는 auth-service가 확인하고, 여기서는 만든 지
  // ORPHAN_PROFILE_MIN_AGE_SECONDS가 지났는지를 DB 시각(NOW) 기준으로 확인합니다 — 막 만들어져 비밀번호 저장을
  // 기다리는 정상 가입을 지우지 않기 위해서입니다. 대상이 아니거나 이미 없으면 success=false.
  async archiveOrphanProfile(
    id: number,
    email: string,
  ): Promise<{ success: boolean }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // 같은 이메일로 동시에 가입해도 한 요청만 옮기도록 행을 잠근다
      const user = await queryRunner.manager
        .createQueryBuilder(User, 'user')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id })
        .andWhere('user.email = :email', { email })
        .andWhere('user.createdAt < NOW(6) - INTERVAL :seconds SECOND', {
          seconds: ORPHAN_PROFILE_MIN_AGE_SECONDS,
        })
        .getOne();
      if (!user) {
        await queryRunner.commitTransaction();
        return { success: false };
      }
      await queryRunner.manager.insert(DeletedUser, this.toDeletedUser(user));
      await queryRunner.manager.delete(User, { id });
      await queryRunner.commitTransaction();
      return { success: true };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // auth-service 로그인 요청으로 이메일 기준 프로필 조회. 미가입 이메일이면 RpcException.
  async getUserByEmail(email: string): Promise<UserGrpcResponse> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw rpcError(GrpcStatus.NOT_FOUND, '가입되지 않은 이메일입니다.');
    }
    return this.toGrpcResponse(user);
  }

  // api-gateway가 관리자 예약 목록에 예약자 이름·이메일을 붙일 때 호출 (LDP-150).
  // 같은 ID는 한 번만 찾고, 없는 ID(탈퇴 등)는 결과에서 빠진다. 너무 많으면 앞의 MAX_USERS_BY_IDS개만.
  async getUsersByIds(
    ids: number[],
  ): Promise<{ users: UserGrpcResponse[]; total: number }> {
    const unique = [...new Set(ids ?? [])]
      .filter((id) => id > 0)
      .slice(0, MAX_USERS_BY_IDS);
    if (unique.length === 0) {
      return { users: [], total: 0 };
    }
    const users = await this.userRepository.find({
      where: { id: In(unique) },
    });
    return {
      users: users.map((user) => this.toGrpcResponse(user)),
      total: users.length,
    };
  }

  // api-gateway 관리자 전용 "회원 목록 조회" 요청 (LDP-136). 조건이 없으면 전체(예전과 같음),
  // 검색어·페이지가 있으면 최근 가입 순으로 그만큼만. 관리자 예약 목록의 회원 검색에도 쓴다.
  async getUsers(
    query: UserListQuery = {},
  ): Promise<{ users: UserGrpcResponse[]; total: number }> {
    const keyword = query.keyword?.trim() ?? '';
    const page = query.page ?? 0;
    if (!keyword && page <= 0) {
      const users = await this.userRepository.find();
      return {
        users: users.map((user) => this.toGrpcResponse(user)),
        total: users.length,
      };
    }

    const pattern = `%${escapeLike(keyword)}%`;
    const size = query.size && query.size > 0 ? query.size : 20;
    const [users, total] = await this.userRepository.findAndCount({
      where: keyword
        ? [
            { name: Like(pattern) },
            { email: Like(pattern) },
            { phoneNumber: Like(pattern) },
          ]
        : {},
      order: { id: 'DESC' },
      ...(page > 0 ? { skip: (page - 1) * size, take: size } : {}),
    });
    return { users: users.map((user) => this.toGrpcResponse(user)), total };
  }

  // api-gateway "내 정보 조회"(JWT의 userId) 및 관리자 "특정 유저 조회" 요청. 없으면 RpcException.
  async getUserById(id: number): Promise<UserGrpcResponse> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 유저입니다.');
    }
    return this.toGrpcResponse(user);
  }

  // api-gateway "내 정보 수정"(JWT의 userId) 요청. 없으면 RpcException.
  async updateUser(
    id: number,
    data: { name: string; phoneNumber: string },
  ): Promise<UserGrpcResponse> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 유저입니다.');
    }

    user.name = data.name;
    user.phoneNumber = data.phoneNumber;
    const saved = await this.userRepository.save(user);
    return this.toGrpcResponse(saved);
  }

  // auth-service "회원 탈퇴"(JWT의 userId) 요청. users 레코드를 deleted_user 백업 테이블로 옮긴 뒤
  // users 테이블에서 제거합니다. 두 작업은 하나의 트랜잭션으로 묶어 백업 없이 삭제되는 사고를 막습니다.
  // 없으면 RpcException.
  async deleteUser(id: number): Promise<{ success: boolean }> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 유저입니다.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.insert(DeletedUser, this.toDeletedUser(user));
      await queryRunner.manager.delete(User, { id });
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return { success: true };
  }

  // deleted_user 백업 레코드 (탈퇴, LDP-111 남은 프로필 정리 공통)
  private toDeletedUser(user: User): Partial<DeletedUser> {
    return {
      originalId: user.id,
      email: user.email,
      name: user.name,
      phoneNumber: user.phoneNumber,
      role: user.role,
      // 탈퇴 시점 상태와 무관하게 백업 레코드는 항상 탈퇴 처리(INACTIVE) 상태로 남깁니다.
      status: UserStatus.INACTIVE,
      originalCreatedAt: user.createdAt,
      originalUpdatedAt: user.updatedAt,
    };
  }

  private toGrpcResponse(user: User): UserGrpcResponse {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phoneNumber: user.phoneNumber,
      role: user.role,
      status: user.status,
    };
  }
}
