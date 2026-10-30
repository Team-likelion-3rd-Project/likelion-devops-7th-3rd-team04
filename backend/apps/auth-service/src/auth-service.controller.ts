import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { PrincipalType } from '@app/common';
import { AuthServiceService } from './auth-service.service';

@Controller()
export class AuthServiceController {
  constructor(private readonly authServiceService: AuthServiceService) {}

  // proto의 AuthService / Register 메서드와 매핑 (회원가입)
  @GrpcMethod('AuthService', 'Register')
  async register(data: {
    email: string;
    password: string;
    name: string;
    phoneNumber: string;
  }) {
    return this.authServiceService.register(data);
  }

  // proto의 AuthService / Login 메서드와 매핑 (로그인, 고객)
  @GrpcMethod('AuthService', 'Login')
  async login(data: { email: string; password: string }) {
    return this.authServiceService.login(data);
  }

  // proto의 AuthService / AdminLogin 메서드와 매핑 (로그인, 관리자 — admins/admin_credentials 테이블 조회)
  @GrpcMethod('AuthService', 'AdminLogin')
  async adminLogin(data: { email: string; password: string }) {
    return this.authServiceService.adminLogin(data);
  }

  // proto의 AuthService / Refresh 메서드와 매핑 (토큰 재발급)
  @GrpcMethod('AuthService', 'Refresh')
  async refresh(data: { refreshToken: string }) {
    return this.authServiceService.refresh(data);
  }

  // proto의 AuthService / Logout 메서드와 매핑 (로그아웃: Redis의 리프레시 토큰 삭제)
  @GrpcMethod('AuthService', 'Logout')
  async logout(data: { userId: number; type: PrincipalType }) {
    return this.authServiceService.logout(data);
  }

  // proto의 AuthService / ChangePassword 메서드와 매핑 (비밀번호 변경)
  @GrpcMethod('AuthService', 'ChangePassword')
  async changePassword(data: {
    userId: number;
    currentPassword: string;
    newPassword: string;
  }) {
    return this.authServiceService.changePassword(data);
  }

  // proto의 AuthService / Withdraw 메서드와 매핑 (회원 탈퇴)
  @GrpcMethod('AuthService', 'Withdraw')
  async withdraw(data: { userId: number }) {
    return this.authServiceService.withdraw(data);
  }

  // proto의 AuthService / SocialAuthorizeUrl 메서드와 매핑 (카카오 인가 화면 주소, LDP-194)
  @GrpcMethod('AuthService', 'SocialAuthorizeUrl')
  async socialAuthorizeUrl(data: { provider: string; redirectUri: string }) {
    return this.authServiceService.socialAuthorizeUrl(data);
  }

  // proto의 AuthService / SocialLogin 메서드와 매핑 (카카오 인가 코드 로그인)
  @GrpcMethod('AuthService', 'SocialLogin')
  async socialLogin(data: { provider: string; code: string; state: string }) {
    return this.authServiceService.socialLogin(data);
  }

  // proto의 AuthService / SocialSignup 메서드와 매핑 (소셜 회원 가입 — 이름·전화번호 입력 후)
  @GrpcMethod('AuthService', 'SocialSignup')
  async socialSignup(data: {
    signupToken: string;
    name: string;
    phoneNumber: string;
  }) {
    return this.authServiceService.socialSignup(data);
  }
}
