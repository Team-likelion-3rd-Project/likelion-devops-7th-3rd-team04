import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from './entities/user.entity';

describe('UserController', () => {
  let userController: UserController;
  let userRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    findAndCount: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: {
      insert: jest.Mock;
      delete: jest.Mock;
      createQueryBuilder: jest.Mock;
    };
  };
  let dataSource: { createQueryRunner: jest.Mock };

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        insert: jest.fn(),
        delete: jest.fn(),
        createQueryBuilder: jest.fn(),
      },
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

      // 조건이 없으면 예전처럼 전체 (LDP-136)
      const result = await userController.getUsers({});

      expect(userRepository.find).toHaveBeenCalled();
      expect(userRepository.findAndCount).not.toHaveBeenCalled();
      expect(result).toEqual({
        users: [
          { id: 1, email: 'a@example.com', name: 'A', phoneNumber: '010-0000-0000', role: 'USER', status: 'ACTIVE' },
          { id: 2, email: 'b@example.com', name: 'B', phoneNumber: '010-1111-1111', role: 'USER', status: 'ACTIVE' },
        ],
        total: 2,
      });
    });

    it('page·size면 최근 가입 순으로 그 페이지만, total은 전체 개수 (LDP-136)', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 45]);

      const result = await userController.getUsers({
        page: 3,
        size: 20,
        keyword: '',
      });

      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { id: 'DESC' },
        skip: 40,
        take: 20,
      });
      expect(result.total).toBe(45);
    });

    it('검색어는 이름·이메일·연락처 중 하나에 들어 있으면 찾고, %·_는 글자 그대로 찾는다', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      await userController.getUsers({ page: 1, size: 20, keyword: '50%_off' });

      const [{ where }] = userRepository.findAndCount.mock.calls[0] as [
        { where: Record<string, { value: string }>[] },
      ];
      expect(where.map((condition) => Object.keys(condition)[0])).toEqual([
        'name',
        'email',
        'phoneNumber',
      ]);
      expect(where[0].name.value).toBe('%50\\%\\_off%');
    });
  });

  // LDP-150: 관리자 예약 목록의 예약자 이름·이메일
  describe('getUsersByIds', () => {
    it('같은 ID는 한 번만, 0 이하는 빼고 한 번에 찾는다', async () => {
      userRepository.find.mockResolvedValue([
        {
          id: 7,
          email: 'a@t.com',
          name: 'A',
          phoneNumber: '010',
          role: 'USER',
          status: 'ACTIVE',
        },
      ]);

      const result = await userController.getUsersByIds({
        ids: [7, 7, 9, 0],
      });

      const [{ where }] = userRepository.find.mock.calls[0] as [
        { where: { id: { value: number[] } } },
      ];
      expect(where.id.value).toEqual([7, 9]);
      expect(result.total).toBe(1);
      expect(result.users[0]).toMatchObject({ id: 7, name: 'A' });
    });

    it('ID가 없으면 DB를 조회하지 않는다', async () => {
      expect(await userController.getUsersByIds({ ids: [] })).toEqual({
        users: [],
        total: 0,
      });
      expect(userRepository.find).not.toHaveBeenCalled();
    });

    it('100개까지만 찾는다', async () => {
      userRepository.find.mockResolvedValue([]);

      await userController.getUsersByIds({
        ids: Array.from({ length: 150 }, (_, i) => i + 1),
      });

      const [{ where }] = userRepository.find.mock.calls[0] as [
        { where: { id: { value: number[] } } },
      ];
      expect(where.id.value).toHaveLength(100);
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

  // LDP-111: 탈퇴가 중간에 멈춰 비밀번호 없이 남은 프로필 정리
  describe('archiveOrphanProfile', () => {
    const queryOf = (found: unknown) => {
      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(found),
      };
      queryRunner.manager.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('만든 지 오래된 남은 프로필을 잠그고 deleted_user로 옮긴 뒤 지운다', async () => {
      const orphan = {
        id: 3,
        email: 'user@example.com',
        name: '홍길동',
        phoneNumber: '010-1234-5678',
        role: 'USER',
        status: 'ACTIVE',
        createdAt: new Date('2026-10-01'),
        updatedAt: new Date('2026-10-01'),
      };
      const qb = queryOf(orphan);

      const result = await userController.archiveOrphanProfile({
        id: 3,
        email: 'user@example.com',
      });

      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(qb.andWhere).toHaveBeenCalledWith(
        'user.createdAt < NOW(6) - INTERVAL :seconds SECOND',
        { seconds: 300 },
      );
      expect(queryRunner.manager.insert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          originalId: 3,
          email: 'user@example.com',
          status: 'INACTIVE',
        }),
      );
      expect(queryRunner.manager.delete).toHaveBeenCalledWith(
        expect.anything(),
        { id: 3 },
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('대상이 아니면(가입 진행 중·이미 없음·이메일 불일치) 아무것도 지우지 않는다', async () => {
      queryOf(null);

      const result = await userController.archiveOrphanProfile({
        id: 3,
        email: 'user@example.com',
      });

      expect(queryRunner.manager.insert).not.toHaveBeenCalled();
      expect(queryRunner.manager.delete).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(result).toEqual({ success: false });
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

  // LDP-96: 회원가입 도중 실패 시 프로필 되돌리기
  describe('cancelSignup', () => {
    it('id와 email이 모두 맞는 프로필만 백업 없이 지운다', async () => {
      await expect(userController.cancelSignup({ id: 7, email: 'a@t.com' })).resolves.toEqual({ success: true });

      expect(userRepository.delete).toHaveBeenCalledWith({ id: 7, email: 'a@t.com' });
      expect(queryRunner.manager.insert).not.toHaveBeenCalled();
    });

    it('이미 없으면(다시 호출) 그대로 성공', async () => {
      userRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(userController.cancelSignup({ id: 7, email: 'a@t.com' })).resolves.toEqual({ success: true });
    });
  });
});
