import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseIntPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ApiCommonResponses } from '@app/common/decorators/api-response.decorator';
import {
  AdminRoles,
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  parseApiRpcError,
  toHttpException,
} from '@app/common';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';

// proto의 User 메시지와 1:1 대응되는 응답 형태
interface UserResponse {
  id: number;
  email: string;
  name: string;
  phoneNumber: string;
  role: string;
  status: string;
}

// proto의 UserService 스펙과 1:1 대응되는 TS 인터페이스
interface UserService {
  getHello(data: {}): Observable<{ message: string }>;
  getUsers(data: {
    page: number;
    size: number;
    keyword: string;
  }): Observable<{ users?: UserResponse[]; total?: number }>;
  getUserById(data: { id: number }): Observable<UserResponse>;
  updateUser(data: { id: number; name: string; phoneNumber: string }): Observable<UserResponse>;
}

// proto의 AuthService 스펙 중 회원 탈퇴에 필요한 부분만 대응되는 TS 인터페이스
interface AuthService {
  withdraw(data: { userId: number }): Observable<{ success: boolean }>;
}

@ApiTags('UserService')
@ApiCommonResponses()
@Controller('api/users')
export class UserController implements OnModuleInit {
  private userService!: UserService;
  private authService!: AuthService;

  constructor(
    @Inject('USER_SERVICE') private readonly client: ClientGrpc,
    @Inject('AUTH_SERVICE') private readonly authClient: ClientGrpc,
  ) {}

  // NestJS 생명주기: 모듈이 초기화될 때 gRPC 서비스 객체를 추출합니다.
  onModuleInit() {
    this.userService = this.client.getService<UserService>('UserService');
    this.authService = this.authClient.getService<AuthService>('AuthService');
  }

  /**
   * GET http://localhost:3000/api/users/hello
   * 브라우저/프론트엔드 HTTP 요청 수신 -> user-service gRPC 호출
   */
  @Get('hello')
  @ApiOperation({
    summary: '유저 도메인 서버 헬스체크',
    description: 'gRPC를 통해 user-service 서버의 상태 및 Hello 메시지를 가져옵니다.'
  })
  @ApiResponse({
    status: 200,
    description: 'User Hello World! 출력'
  })
  getHello(): Observable<{ message: string }> {
    return this.userService.getHello({});
  }

  /**
   * GET http://localhost:3000/api/users
   * 관리자 전용. 전체 유저 목록을 조회합니다.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '회원 목록 조회 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. 조건이 없으면 전체(가입 순), ' +
      'page를 주면 그 페이지만(최근 가입 순) 돌려줍니다. keyword는 이름·이메일·연락처 일부. total은 조건에 맞는 전체 개수 (LDP-136).',
  })
  @ApiResponse({
    status: 200,
    description: '{ users, total }',
  })
  @ApiResponse({
    status: 403,
    description: '관리자 권한이 없음',
  })
  async getUsers(
    @Query() query: UserListQueryDto,
  ): Promise<{ users: UserResponse[]; total: number }> {
    const { users = [], total = 0 } = await firstValueFrom(
      this.userService.getUsers({
        page: query.page ?? 0,
        size: query.size ?? 20,
        keyword: query.keyword?.trim() ?? '',
      }),
    );
    return { users, total };
  }

  /**
   * GET http://localhost:3000/api/users/me
   * 로그인한 사용자 본인의 정보를 조회합니다.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내 정보 조회',
    description: '유효한 액세스 토큰을 가진 사용자 본인의 프로필 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '내 정보 조회 성공',
  })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return firstValueFrom(this.userService.getUserById({ id: user.userId })).catch((err) => {
      throw new NotFoundException(err?.details || err?.message || '유저 정보를 찾을 수 없습니다.');
    });
  }

  /**
   * PUT http://localhost:3000/api/users/me
   * 로그인한 사용자 본인의 정보를 수정합니다.
   */
  @Put('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내 정보 수정',
    description: '유효한 액세스 토큰을 가진 사용자 본인의 이름/전화번호를 수정합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '내 정보 수정 성공',
  })
  @ApiResponse({
    status: 400,
    description: '요청 형식이 올바르지 않음',
  })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMeDto,
  ): Promise<UserResponse> {
    return firstValueFrom(
      this.userService.updateUser({ id: user.userId, ...dto }),
    ).catch((err) => {
      throw new NotFoundException(err?.details || err?.message || '유저 정보를 찾을 수 없습니다.');
    });
  }

  /**
   * DELETE http://localhost:3000/api/users/me
   * 로그인한 사용자 본인의 계정을 탈퇴 처리합니다.
   * auth-service가 gRPC로 user-service에 프로필 삭제(deleted_user 백업 테이블 이관 포함)를 요청하고,
   * 이어서 자격증명(비밀번호 해시)과 Redis의 리프레시 토큰도 함께 삭제합니다.
   */
  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '회원 탈퇴',
    description:
      '유효한 액세스 토큰을 가진 사용자 본인의 계정을 탈퇴 처리합니다. 프로필은 users 테이블에서 제거되고 ' +
      'deleted_user 백업 테이블로 그대로 이관되며, 비밀번호(자격증명)와 로그인 세션(리프레시 토큰)도 함께 삭제됩니다.',
  })
  @ApiResponse({
    status: 200,
    description: '회원 탈퇴 성공',
  })
  @ApiResponse({
    status: 404,
    description: '존재하지 않는 유저',
  })
  @ApiResponse({
    status: 409,
    description: 'HAS_UPCOMING_RESERVATIONS — 이용 예정 예약(결제 대기, 체크아웃이 오늘 이후인 확정 예약)이 있어 탈퇴 불가',
  })
  @ApiResponse({ status: 503, description: 'BOOKING_SERVICE_UNAVAILABLE — 예약 확인 불가, 재시도' })
  async deleteMe(@CurrentUser() user: AuthenticatedUser): Promise<{ message: string }> {
    await firstValueFrom(this.authService.withdraw({ userId: user.userId })).catch((err) => {
      // 이용 예정 예약 거절(409)·예약 확인 불가(503)는 실패 응답 형식 { statusCode, error, code, message, retryable }으로 (LDP-95)
      const payload = parseApiRpcError(err);
      if (payload) {
        throw toHttpException(payload);
      }
      throw new NotFoundException(err?.details || err?.message || '회원 탈퇴에 실패했습니다.');
    });
    return { message: '회원 탈퇴가 완료되었습니다.' };
  }

  /**
   * GET http://localhost:3000/api/users/:userId
   * 관리자 전용. 특정 유저의 정보를 조회합니다.
   */
  @Get(':userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @AdminRoles('SUPER')
  @ApiBearerAuth()
  @ApiParam({ name: 'userId', description: '조회할 유저의 ID', type: Number })
  @ApiOperation({
    summary: '특정 유저 정보 조회 (관리자 전용)',
    description: '관리자 권한을 가진 사용자만 호출할 수 있습니다. userId로 특정 유저의 프로필 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '유저 정보 조회 성공',
  })
  @ApiResponse({
    status: 403,
    description: '관리자 권한이 없음',
  })
  @ApiResponse({
    status: 404,
    description: '존재하지 않는 유저',
  })
  async getUserById(@Param('userId', ParseIntPipe) userId: number): Promise<UserResponse> {
    return firstValueFrom(this.userService.getUserById({ id: userId })).catch((err) => {
      throw new NotFoundException(err?.details || err?.message || '유저 정보를 찾을 수 없습니다.');
    });
  }
}
