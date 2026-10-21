import { Test, TestingModule } from '@nestjs/testing';
import { AuthServiceController } from './auth-service.controller';
import { AuthServiceService } from './auth-service.service';

describe('AuthServiceController', () => {
  let authServiceController: AuthServiceController;
  let authServiceService: {
    register: jest.Mock;
    login: jest.Mock;
    adminLogin: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    changePassword: jest.Mock;
    withdraw: jest.Mock;
  };

  beforeEach(async () => {
    authServiceService = {
      register: jest.fn(),
      login: jest.fn(),
      adminLogin: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      changePassword: jest.fn(),
      withdraw: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AuthServiceController],
      providers: [
        { provide: AuthServiceService, useValue: authServiceService },
      ],
    }).compile();

    authServiceController = app.get<AuthServiceController>(
      AuthServiceController,
    );
  });

  describe('register', () => {
    it('should delegate to AuthServiceService.register', async () => {
      const dto = {
        email: 'user@example.com',
        password: 'password123',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
      };
      authServiceService.register.mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      const result = await authServiceController.register(dto);

      expect(authServiceService.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        accessToken: 'access',
        refreshToken: 'refresh',
      });
    });
  });

  describe('login', () => {
    it('should delegate to AuthServiceService.login', async () => {
      const dto = { email: 'user@example.com', password: 'password123' };
      authServiceService.login.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });

      const result = await authServiceController.login(dto);

      expect(authServiceService.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    });
  });

  describe('adminLogin', () => {
    it('should delegate to AuthServiceService.adminLogin', async () => {
      const dto = { email: 'admin@example.com', password: 'password123' };
      authServiceService.adminLogin.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });

      const result = await authServiceController.adminLogin(dto);

      expect(authServiceService.adminLogin).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    });
  });

  describe('refresh', () => {
    it('should delegate to AuthServiceService.refresh', async () => {
      const dto = { refreshToken: 'refresh' };
      authServiceService.refresh.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });

      const result = await authServiceController.refresh(dto);

      expect(authServiceService.refresh).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    });
  });

  describe('logout', () => {
    it('should delegate to AuthServiceService.logout', async () => {
      const dto: { userId: number; type: 'USER' | 'ADMIN' } = { userId: 1, type: 'USER' };
      authServiceService.logout.mockResolvedValue({ success: true });

      const result = await authServiceController.logout(dto);

      expect(authServiceService.logout).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ success: true });
    });
  });

  describe('changePassword', () => {
    it('should delegate to AuthServiceService.changePassword', async () => {
      const data = { userId: 1, currentPassword: 'password123', newPassword: 'newPassword456' };
      authServiceService.changePassword.mockResolvedValue({ success: true });

      const result = await authServiceController.changePassword(data);

      expect(authServiceService.changePassword).toHaveBeenCalledWith(data);
      expect(result).toEqual({ success: true });
    });
  });

  describe('withdraw', () => {
    it('should delegate to AuthServiceService.withdraw', async () => {
      const data = { userId: 1 };
      authServiceService.withdraw.mockResolvedValue({ success: true });

      const result = await authServiceController.withdraw(data);

      expect(authServiceService.withdraw).toHaveBeenCalledWith(data);
      expect(result).toEqual({ success: true });
    });
  });
});
