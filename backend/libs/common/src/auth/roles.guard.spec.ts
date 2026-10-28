import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';
import { AdminRole, AuthenticatedUser } from './jwt-payload.interface';

describe('RolesGuard', () => {
  const createContext = (
    user?: AuthenticatedUser,
    params?: Record<string, string>,
  ): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user, params }),
      }),
    }) as unknown as ExecutionContext;

  // ROLES_KEY는 @Roles, 그 밖(ADMIN_ROLES_KEY)은 @AdminRoles 값
  const createGuard = (requiredRoles?: string[], adminRoles?: AdminRole[]) => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === ROLES_KEY ? requiredRoles : adminRoles,
      ),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('통과: @Roles()가 없는 라우트는 그대로 허용한다', () => {
    const guard = createGuard(undefined);
    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('통과: role이 ADMIN이고 admins DB를 거친 토큰(type: ADMIN)이면 허용한다', () => {
    const guard = createGuard(['ADMIN']);
    const context = createContext({
      userId: 1,
      email: 'admin@example.com',
      role: 'ADMIN',
      type: 'ADMIN',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('거부: 레거시 users.role=ADMIN 값으로 발급된 토큰(type: USER)은 관리자 API를 통과하지 못한다', () => {
    const guard = createGuard(['ADMIN']);
    const context = createContext({
      userId: 1,
      email: 'legacy@example.com',
      role: 'ADMIN',
      type: 'USER',
    });
    expect(guard.canActivate(context)).toBe(false);
  });

  it('거부: role 자체가 요구 role 목록에 없으면 거부한다', () => {
    const guard = createGuard(['ADMIN']);
    const context = createContext({
      userId: 1,
      email: 'user@example.com',
      role: 'USER',
      type: 'USER',
    });
    expect(guard.canActivate(context)).toBe(false);
  });

  it('거부: req.user가 없으면 거부한다', () => {
    const guard = createGuard(['ADMIN']);
    expect(guard.canActivate(createContext(undefined))).toBe(false);
  });

  // LDP-178: 관리자 직급(@AdminRoles)·지점(:hotelId) 검사
  describe('관리자 직급·지점', () => {
    const adminOf = (
      adminRole?: AdminRole,
      hotelId?: number | null,
    ): AuthenticatedUser => ({
      userId: 1,
      email: 'admin@example.com',
      role: 'ADMIN',
      type: 'ADMIN',
      adminRole,
      hotelId,
    });
    const codeOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const err = e as HttpException;
        return [err.getStatus(), (err.getResponse() as { code: string }).code];
      }
      return 'passed';
    };

    it('본사는 어느 지점 경로든 통과한다', () => {
      const guard = createGuard(['ADMIN']);
      expect(
        guard.canActivate(
          createContext(adminOf('SUPER', null), { hotelId: '2' }),
        ),
      ).toBe(true);
    });

    it('지점 계정은 자기 지점 경로만 통과하고, 다른 지점이면 403 ADMIN_HOTEL_FORBIDDEN', () => {
      const guard = createGuard(['ADMIN']);
      const seoul = adminOf('MANAGER', 1);
      expect(guard.canActivate(createContext(seoul, { hotelId: '1' }))).toBe(
        true,
      );
      expect(
        codeOf(() => guard.canActivate(createContext(seoul, { hotelId: '2' }))),
      ).toEqual([403, 'ADMIN_HOTEL_FORBIDDEN']);
    });

    it('@AdminRoles에 없는 직급이면 403 ADMIN_ROLE_FORBIDDEN', () => {
      const guard = createGuard(['ADMIN'], ['SUPER', 'MANAGER']);
      expect(
        codeOf(() =>
          guard.canActivate(
            createContext(adminOf('STAFF', 1), { hotelId: '1' }),
          ),
        ),
      ).toEqual([403, 'ADMIN_ROLE_FORBIDDEN']);
      expect(
        guard.canActivate(
          createContext(adminOf('MANAGER', 1), { hotelId: '1' }),
        ),
      ).toBe(true);
    });

    it('직급 정보가 없는 예전 토큰은 본사로 본다 (LDP-176 이전엔 본사 계정만 있었음)', () => {
      const guard = createGuard(['ADMIN'], ['SUPER']);
      expect(
        guard.canActivate(
          createContext(adminOf(undefined, undefined), { hotelId: '3' }),
        ),
      ).toBe(true);
    });

    it('지점 계정인데 지점이 없으면 어느 지점도 허용하지 않는다', () => {
      const guard = createGuard(['ADMIN']);
      expect(
        codeOf(() =>
          guard.canActivate(
            createContext(adminOf('STAFF', null), { hotelId: '1' }),
          ),
        ),
      ).toEqual([403, 'ADMIN_HOTEL_FORBIDDEN']);
    });
  });
});
