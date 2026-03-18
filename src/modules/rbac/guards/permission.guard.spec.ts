import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import type { PermissionResolverService } from '../services/permission-resolver.service';
import { mockI18nContext } from '@common/test/i18n-mock';

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;

  let permissionResolver: {
    hasAllPermissions: jest.Mock;
    hasAnyPermission: jest.Mock;
  };

  beforeEach(() => {
    mockI18nContext();
    reflector = new Reflector();
    permissionResolver = {
      hasAllPermissions: jest.fn(),
      hasAnyPermission: jest.fn(),
    };
    guard = new PermissionGuard(
      reflector,
      permissionResolver as unknown as PermissionResolverService,
    );
  });

  function createMockContext(overrides: {
    isPublic?: boolean;
    requiredAll?: string[] | undefined;
    requiredAny?: string[] | undefined;
    userId?: string | undefined;
  }) {
    const { isPublic = false, requiredAll, requiredAny, userId } = overrides;

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) => {
        if (key === 'isPublic') return isPublic;
        if (key === 'permissions') return requiredAll;
        if (key === 'anyPermission') return requiredAny;
        return undefined;
      });

    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: userId ? { id: userId } : undefined }),
      }),
    } as unknown;
  }

  it('should allow public routes', async () => {
    const ctx = createMockContext({ isPublic: true });
    expect(await guard.canActivate(ctx as never)).toBe(true);
  });

  it('should allow when no permission decorators are present', async () => {
    const ctx = createMockContext({ userId: 'u1' });
    expect(await guard.canActivate(ctx as never)).toBe(true);
  });

  it('should throw ForbiddenException when no user context', async () => {
    const ctx = createMockContext({ requiredAll: ['user:read'] });
    await expect(guard.canActivate(ctx as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should check AND permissions (requiredAll)', async () => {
    const ctx = createMockContext({
      requiredAll: ['user:read', 'user:write'],
      userId: 'u1',
    });
    permissionResolver.hasAllPermissions.mockResolvedValue(true);

    expect(await guard.canActivate(ctx as never)).toBe(true);
    expect(permissionResolver.hasAllPermissions).toHaveBeenCalledWith('u1', [
      'user:read',
      'user:write',
    ]);
  });

  it('should throw when AND permissions not met', async () => {
    const ctx = createMockContext({
      requiredAll: ['user:read', 'user:write'],
      userId: 'u1',
    });
    permissionResolver.hasAllPermissions.mockResolvedValue(false);

    await expect(guard.canActivate(ctx as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should check OR permissions (requiredAny)', async () => {
    const ctx = createMockContext({
      requiredAny: ['user:read', 'user:write'],
      userId: 'u1',
    });
    permissionResolver.hasAnyPermission.mockResolvedValue(true);

    expect(await guard.canActivate(ctx as never)).toBe(true);
  });

  it('should throw when OR permissions not met', async () => {
    const ctx = createMockContext({
      requiredAny: ['user:read', 'user:write'],
      userId: 'u1',
    });
    permissionResolver.hasAnyPermission.mockResolvedValue(false);

    await expect(guard.canActivate(ctx as never)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
