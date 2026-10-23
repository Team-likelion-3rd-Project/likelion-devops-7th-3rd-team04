import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { NotFoundException } from '@nestjs/common';
import { UserController } from './user.controller';

describe('UserController', () => {
  let controller: UserController;
  const getHelloMock = jest.fn();
  const getUsersMock = jest.fn();
  const getUserByIdMock = jest.fn();
  const updateUserMock = jest.fn();
  const withdrawMock = jest.fn();

  beforeEach(async () => {
    getHelloMock.mockReturnValue(of({ message: 'User Hello World!' }));
    getUsersMock.mockReturnValue(of({ users: [] }));
    getUserByIdMock.mockReturnValue(
      of({ id: 1, email: 'user@example.com', name: '홍길동', phoneNumber: '010-1234-5678', role: 'USER', status: 'ACTIVE' }),
    );
    updateUserMock.mockReturnValue(
      of({ id: 1, email: 'user@example.com', name: '홍길동', phoneNumber: '010-1234-5678', role: 'USER', status: 'ACTIVE' }),
    );
    withdrawMock.mockReturnValue(of({ success: true }));

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: 'USER_SERVICE',
          useValue: {
            getService: () => ({
              getHello: getHelloMock,
              getUsers: getUsersMock,
              getUserById: getUserByIdMock,
              updateUser: updateUserMock,
            }),
          },
        },
        {
          provide: 'AUTH_SERVICE',
          useValue: {
            getService: () => ({
              withdraw: withdrawMock,
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    controller.onModuleInit();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getUsers', () => {
    it('should call user-service via gRPC and return the user list', async () => {
      const users = [{ id: 1, email: 'a@example.com', name: 'A', phoneNumber: '010', role: 'USER', status: 'ACTIVE' }];
      getUsersMock.mockReturnValue(of({ users }));

      getUsersMock.mockReturnValue(of({ users, total: 1 }));

      const result = await controller.getUsers({});

      // 조건이 없으면 페이지를 나누지 않는다 (예전과 같은 전체 목록, LDP-136)
      expect(getUsersMock).toHaveBeenCalledWith({
        page: 0,
        size: 20,
        keyword: '',
      });
      expect(result).toEqual({ users, total: 1 });
    });

    it('page·size·keyword를 user-service에 넘긴다 (검색어 앞뒤 공백 제거, LDP-136)', async () => {
      getUsersMock.mockReturnValue(of({ users: [], total: 0 }));

      await controller.getUsers({ page: 2, size: 10, keyword: ' 홍길동 ' });

      expect(getUsersMock).toHaveBeenCalledWith({
        page: 2,
        size: 10,
        keyword: '홍길동',
      });
    });

    it('gRPC가 빈 목록을 생략해도 users·total을 채워 돌려준다', async () => {
      getUsersMock.mockReturnValue(of({}));

      expect(await controller.getUsers({})).toEqual({ users: [], total: 0 });
    });
  });

  describe('getMe', () => {
    it('should look up the current user by the id from the JWT payload', async () => {
      const user = { userId: 1, email: 'user@example.com', role: 'USER', type: 'USER' as const };

      const result = await controller.getMe(user);

      expect(getUserByIdMock).toHaveBeenCalledWith({ id: 1 });
      expect(result).toEqual({
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
      });
    });

    it('should throw NotFoundException when the profile is missing', async () => {
      getUserByIdMock.mockReturnValue(throwError(() => ({ message: '존재하지 않는 유저입니다.' })));
      const user = { userId: 999, email: 'ghost@example.com', role: 'USER', type: 'USER' as const };

      await expect(controller.getMe(user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('should update the current user by the id from the JWT payload', async () => {
      const user = { userId: 1, email: 'user@example.com', role: 'USER', type: 'USER' as const };
      const dto = { name: '김철수', phoneNumber: '010-9999-9999' };
      updateUserMock.mockReturnValue(
        of({ id: 1, email: 'user@example.com', name: '김철수', phoneNumber: '010-9999-9999', role: 'USER', status: 'ACTIVE' }),
      );

      const result = await controller.updateMe(user, dto);

      expect(updateUserMock).toHaveBeenCalledWith({ id: 1, name: '김철수', phoneNumber: '010-9999-9999' });
      expect(result).toEqual({
        id: 1,
        email: 'user@example.com',
        name: '김철수',
        phoneNumber: '010-9999-9999',
        role: 'USER',
        status: 'ACTIVE',
      });
    });

    it('should throw NotFoundException when the profile is missing', async () => {
      updateUserMock.mockReturnValue(throwError(() => ({ message: '존재하지 않는 유저입니다.' })));
      const user = { userId: 999, email: 'ghost@example.com', role: 'USER', type: 'USER' as const };
      const dto = { name: '김철수', phoneNumber: '010-9999-9999' };

      await expect(controller.updateMe(user, dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteMe', () => {
    it('should withdraw the current user by the id from the JWT payload', async () => {
      const user = { userId: 1, email: 'user@example.com', role: 'USER', type: 'USER' as const };

      const result = await controller.deleteMe(user);

      expect(withdrawMock).toHaveBeenCalledWith({ userId: 1 });
      expect(result).toEqual({ message: '회원 탈퇴가 완료되었습니다.' });
    });

    it('should throw NotFoundException when the profile is missing', async () => {
      withdrawMock.mockReturnValue(throwError(() => ({ message: '존재하지 않는 유저입니다.' })));
      const user = { userId: 999, email: 'ghost@example.com', role: 'USER', type: 'USER' as const };

      await expect(controller.deleteMe(user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserById', () => {
    it('should look up a user by the userId path param', async () => {
      const result = await controller.getUserById(1);

      expect(getUserByIdMock).toHaveBeenCalledWith({ id: 1 });
      expect(result).toEqual({
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
      });
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      getUserByIdMock.mockReturnValue(throwError(() => ({ message: '존재하지 않는 유저입니다.' })));

      await expect(controller.getUserById(999)).rejects.toThrow(NotFoundException);
    });
  });
});
