import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AuthenticatedUser } from './jwt-payload.interface';

describe('RolesGuard', () => {
  const createContext = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  const createGuard = (requiredRoles?: string[]) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
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
});
