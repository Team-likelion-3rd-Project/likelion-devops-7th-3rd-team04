import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { UserServiceController } from './user-service.controller';
import { UserServiceService } from './user-service.service';

// 도메인 로직 테스트는 각각 ./user/user.controller.spec.ts, ./admin(추가 시)를 참고하세요.
describe('UserServiceController', () => {
  let userServiceController: UserServiceController;

  beforeEach(async () => {
    const dataSource = { createQueryRunner: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [UserServiceController],
      providers: [
        UserServiceService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    userServiceController = app.get<UserServiceController>(
      UserServiceController,
    );
  });

  describe('getHello', () => {
    it('should return "User Hello World!"', () => {
      expect(userServiceController.getHello()).toEqual({
        message: 'User Hello World!',
      });
    });
  });
});
