import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from './entities/user.entity';

describe('UserController', () => {
  let userController: UserController;
  let userRepository: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: { insert: jest.Mock; delete: jest.Mock };
  };
  let dataSource: { createQueryRunner: jest.Mock };

  beforeEach(async () => {
    userRepository = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: { insert: jest.fn(), delete: jest.fn() },
    };
    dataSource = { createQueryRunner: jest.fn(() => queryRunner) };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    }).compile();

    userController = app.get<UserController>(UserController);
  });

  describe('getUserByEmail', () => {
    it('should return the profile when the email is registered', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
      });

      const result = await userController.getUserByEmail({ email: 'user@example.com' });

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { email: 'user@example.com' } });
      expect(result).toEqual({
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
      });
    });

    it('should throw when the email is not registered', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userController.getUserByEmail({ email: 'missing@example.com' })).rejects.toThrow();
    });
  });

  describe('getUsers', () => {
    it('should return every user mapped to the gRPC response shape', async () => {
      userRepository.find.mockResolvedValue([
        { id: 1, email: 'a@example.com', name: 'A', phoneNumber: '010-0000-0000', role: 'USER', status: 'ACTIVE' },
        { id: 2, email: 'b@example.com', name: 'B', phoneNumber: '010-1111-1111', role: 'USER', status: 'ACTIVE' },
      ]);

      const result = await userController.getUsers();

      expect(userRepository.find).toHaveBeenCalled();
      expect(result).toEqual({
        users: [
          { id: 1, email: 'a@example.com', name: 'A', phoneNumber: '010-0000-0000', role: 'USER', status: 'ACTIVE' },
          { id: 2, email: 'b@example.com', name: 'B', phoneNumber: '010-1111-1111', role: 'USER', status: 'ACTIVE' },
        ],
      });
    });
  });

  describe('getUserById', () => {
    it('should return the profile when the id exists', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
      });

      const result = await userController.getUserById({ id: 1 });

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
      });
    });

    it('should throw when the id does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userController.getUserById({ id: 999 })).rejects.toThrow();
    });
  });

  describe('updateUser', () => {
    it('should update the name/phoneNumber and return the saved profile', async () => {
      const existing = {
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
      };
      userRepository.findOne.mockResolvedValue(existing);
      userRepository.save.mockImplementation((user) => Promise.resolve(user));

      const result = await userController.updateUser({
        id: 1,
        name: '김철수',
        phoneNumber: '010-9999-9999',
      });

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: '김철수', phoneNumber: '010-9999-9999' }),
      );
      expect(result).toEqual({
        id: 1,
        email: 'user@example.com',
        name: '김철수',
        phoneNumber: '010-9999-9999',
        role: 'USER',
        status: 'ACTIVE',
      });
    });

    it('should throw when the id does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        userController.updateUser({ id: 999, name: '김철수', phoneNumber: '010-9999-9999' }),
      ).rejects.toThrow();
    });
  });

  describe('deleteUser', () => {
    it('should back up the user into deleted_user and remove it from users within a transaction', async () => {
      const existing = {
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };
      userRepository.findOne.mockResolvedValue(existing);

      const result = await userController.deleteUser({ id: 1 });

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(queryRunner.manager.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          originalId: 1,
          email: 'user@example.com',
          // 탈퇴 전 상태가 ACTIVE였더라도 백업 레코드는 항상 INACTIVE(탈퇴 처리)로 남아야 합니다.
          status: 'INACTIVE',
          originalCreatedAt: existing.createdAt,
          originalUpdatedAt: existing.updatedAt,
        }),
      );
      expect(queryRunner.manager.delete).toHaveBeenCalledWith(expect.anything(), { id: 1 });
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should throw when the id does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userController.deleteUser({ id: 999 })).rejects.toThrow();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('should roll back the transaction when the backup insert fails', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      queryRunner.manager.insert.mockRejectedValue(new Error('DB error'));

      await expect(userController.deleteUser({ id: 1 })).rejects.toThrow('DB error');

      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });
});
