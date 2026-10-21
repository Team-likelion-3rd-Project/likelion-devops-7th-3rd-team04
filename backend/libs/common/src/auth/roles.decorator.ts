import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// 예: @Roles('ADMIN')  — RolesGuard와 함께 사용합니다.
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
