import { Test } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OwnershipGuard } from './ownership.guard';
import { PrismaService } from '@modules/database';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { mockI18nContext } from '@common/test/i18n-mock';

function createMockContext(
  params: Record<string, string>,
  user?: { id: string },
): ExecutionContext {
  return {
    getHandler: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ params, user }),
    }),
  } as unknown as ExecutionContext;
}

describe('OwnershipGuard', () => {
  let guard: OwnershipGuard;
  let reflector: { get: jest.Mock };
  let prisma: { baseClient: Record<string, Record<string, jest.Mock>> };
  let permissionResolver: { hasPermission: jest.Mock };

  beforeEach(async () => {
    mockI18nContext();
    reflector = { get: jest.fn() };

    prisma = {
      baseClient: {
        chatSession: { findFirst: jest.fn() },
        appointment: { findFirst: jest.fn() },
        provider: { findFirst: jest.fn() },
      },
    };

    permissionResolver = {
      hasPermission: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        OwnershipGuard,
        { provide: Reflector, useValue: reflector },
        { provide: PrismaService, useValue: prisma },
        {
          provide: PermissionResolverService,
          useValue: permissionResolver,
        },
      ],
    }).compile();

    guard = module.get(OwnershipGuard);
  });

  it('should pass through when no @CheckOwnership metadata', async () => {
    reflector.get.mockReturnValue(undefined);

    const result = await guard.canActivate(
      createMockContext({ id: 'res-1' }, { id: 'user-1' }),
    );
    expect(result).toBe(true);
  });

  it('should throw ForbiddenException when no user context', async () => {
    reflector.get.mockReturnValue({
      model: 'chatSession',
      ownerField: 'user_id',
    });

    await expect(
      guard.canActivate(createMockContext({ id: 'res-1' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when resource param is missing', async () => {
    reflector.get.mockReturnValue({
      model: 'chatSession',
      ownerField: 'user_id',
    });

    await expect(
      guard.canActivate(createMockContext({}, { id: 'user-1' })),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('direct ownership', () => {
    beforeEach(() => {
      reflector.get.mockReturnValue({
        model: 'chatSession',
        ownerField: 'user_id',
      });
    });

    it('should allow owner', async () => {
      prisma.baseClient.chatSession.findFirst.mockResolvedValue({
        id: 'session-1',
      });

      const result = await guard.canActivate(
        createMockContext({ id: 'session-1' }, { id: 'user-1' }),
      );
      expect(result).toBe(true);
      expect(prisma.baseClient.chatSession.findFirst).toHaveBeenCalledWith({
        where: { id: 'session-1', user_id: 'user-1', is_active: true },
        select: { id: true },
      });
    });

    it('should block non-owner', async () => {
      prisma.baseClient.chatSession.findFirst.mockResolvedValue(null);

      await expect(
        guard.canActivate(
          createMockContext({ id: 'session-1' }, { id: 'user-2' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('indirect ownership', () => {
    beforeEach(() => {
      reflector.get.mockReturnValue({
        model: 'appointment',
        ownerField: 'provider_id',
        through: {
          model: 'provider',
          userField: 'user_id',
        },
      });
    });

    it('should allow owner through join', async () => {
      prisma.baseClient.provider.findFirst.mockResolvedValue({
        id: 'provider-1',
      });
      prisma.baseClient.appointment.findFirst.mockResolvedValue({
        id: 'apt-1',
      });

      const result = await guard.canActivate(
        createMockContext({ id: 'apt-1' }, { id: 'user-1' }),
      );
      expect(result).toBe(true);
    });

    it('should block when no intermediate entity found', async () => {
      prisma.baseClient.provider.findFirst.mockResolvedValue(null);

      await expect(
        guard.canActivate(createMockContext({ id: 'apt-1' }, { id: 'user-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should block when resource not owned by intermediate', async () => {
      prisma.baseClient.provider.findFirst.mockResolvedValue({
        id: 'provider-1',
      });
      prisma.baseClient.appointment.findFirst.mockResolvedValue(null);

      await expect(
        guard.canActivate(createMockContext({ id: 'apt-1' }, { id: 'user-1' })),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('bypass permission', () => {
    it('should allow user with bypass permission even if not owner', async () => {
      reflector.get.mockReturnValue({
        model: 'appointment',
        ownerField: 'provider_id',
        bypassPermission: 'appointments:update:any',
        through: {
          model: 'provider',
          userField: 'user_id',
        },
      });
      permissionResolver.hasPermission.mockResolvedValue(true);

      const result = await guard.canActivate(
        createMockContext({ id: 'apt-1' }, { id: 'manager-1' }),
      );
      expect(result).toBe(true);
      expect(permissionResolver.hasPermission).toHaveBeenCalledWith(
        'manager-1',
        'appointments:update:any',
      );
      // Should not check ownership at all
      expect(prisma.baseClient.provider.findFirst).not.toHaveBeenCalled();
    });

    it('should fall through to ownership check when bypass denied', async () => {
      reflector.get.mockReturnValue({
        model: 'chatSession',
        ownerField: 'user_id',
        bypassPermission: 'chat_sessions:update:any',
      });
      permissionResolver.hasPermission.mockResolvedValue(false);
      prisma.baseClient.chatSession.findFirst.mockResolvedValue({
        id: 'session-1',
      });

      const result = await guard.canActivate(
        createMockContext({ id: 'session-1' }, { id: 'user-1' }),
      );
      expect(result).toBe(true);
      expect(prisma.baseClient.chatSession.findFirst).toHaveBeenCalled();
    });
  });

  describe('custom paramKey', () => {
    it('should use custom param key for resource ID', async () => {
      reflector.get.mockReturnValue({
        model: 'chatSession',
        ownerField: 'user_id',
        paramKey: 'sessionId',
      });
      prisma.baseClient.chatSession.findFirst.mockResolvedValue({
        id: 'session-1',
      });

      const result = await guard.canActivate(
        createMockContext({ sessionId: 'session-1' }, { id: 'user-1' }),
      );
      expect(result).toBe(true);
      expect(prisma.baseClient.chatSession.findFirst).toHaveBeenCalledWith({
        where: { id: 'session-1', user_id: 'user-1', is_active: true },
        select: { id: true },
      });
    });
  });
});
