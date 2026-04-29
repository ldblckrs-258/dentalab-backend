import { Test } from '@nestjs/testing';
import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';
import { CacheService } from '@modules/redis';
import { QueueProducerService } from '@modules/queue';
import { StorageService } from '@modules/storage';
import { AuditService } from '@modules/audit/audit.service';
import { mockI18nContext } from '@common/test/i18n-mock';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: Record<string, unknown>;
  let cacheService: Record<string, jest.Mock>;
  let queueProducer: Record<string, jest.Mock>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    fullName: 'Test User',
    isActive: true,
    passwordHash: 'hashed-password',
  };

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      client: {
        user: {
          findUnique: jest.fn(),
        },
      },
      baseClient: {
        refreshToken: {
          create: jest.fn(),
          findFirst: jest.fn(),
          delete: jest.fn(),
          deleteMany: jest.fn(),
        },
        userRole: { findMany: jest.fn().mockResolvedValue([]) },
        userPermissionOverride: { findMany: jest.fn().mockResolvedValue([]) },
        passwordResetToken: {
          create: jest.fn(),
          findFirst: jest.fn(),
        },
        user: { update: jest.fn() },
      },
      transaction: jest.fn((fn: (tx: Record<string, unknown>) => unknown) =>
        fn({
          user: { update: jest.fn() },
          passwordResetToken: { update: jest.fn() },
          refreshToken: { deleteMany: jest.fn() },
        }),
      ),
    };

    cacheService = {
      exists: jest.fn().mockResolvedValue(false),
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      increment: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(undefined),
    };
    queueProducer = { publish: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('access-token') },
        },
        {
          provide: AppConfigService,
          useValue: {
            jwt: { JWT_REFRESH_EXPIRY: '7d' },
            app: { MAX_LOGIN_ATTEMPTS: 5, LOCKOUT_DURATION_MINUTES: 15 },
          },
        },
        { provide: CacheService, useValue: cacheService },
        { provide: QueueProducerService, useValue: queueProducer },
        {
          provide: StorageService,
          useValue: { resolveAvatarUrl: jest.fn((url: string | null) => url) },
        },
        {
          provide: AuditService,
          useValue: { emit: jest.fn(), emitFailure: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login', () => {
    it('should return tokens and user on valid credentials', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.create.mockResolvedValue({});

      const result = await service.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'missing@test.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException for deactivated account', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(
        service.login({ email: 'test@example.com', password: 'pass' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw 429 when login attempts exceed limit', async () => {
      cacheService.get.mockResolvedValue(5);

      await expect(
        service.login({ email: 'test@example.com', password: 'pass' }),
      ).rejects.toThrow(HttpException);

      await expect(
        service.login({ email: 'test@example.com', password: 'pass' }),
      ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

      // Should NOT query DB
      expect(
        (prisma.client as Record<string, Record<string, jest.Mock>>).user
          .findUnique,
      ).not.toHaveBeenCalled();
    });

    it('should increment counter on wrong password', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(cacheService.increment).toHaveBeenCalledWith(
        'auth',
        'login_attempts:test@example.com',
        900,
      );
    });

    it('should increment counter on non-existent user', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'missing@test.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(cacheService.increment).toHaveBeenCalledWith(
        'auth',
        'login_attempts:missing@test.com',
        900,
      );
    });

    it('should NOT increment counter for deactivated account', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(
        service.login({ email: 'test@example.com', password: 'pass' }),
      ).rejects.toThrow(ForbiddenException);

      expect(cacheService.increment).not.toHaveBeenCalled();
    });

    it('should reset counter on successful login', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.create.mockResolvedValue({});

      await service.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(cacheService.del).toHaveBeenCalledWith(
        'auth',
        'login_attempts:test@example.com',
      );
    });
  });

  describe('refreshTokens', () => {
    it('should throw if token is blacklisted', async () => {
      cacheService.exists.mockResolvedValue(true);

      await expect(
        service.refreshTokens({ refreshToken: 'token-abc' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if token not found in DB', async () => {
      cacheService.exists.mockResolvedValue(false);
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.findFirst.mockResolvedValue(null);

      await expect(
        service.refreshTokens({ refreshToken: 'token-abc' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if user is inactive', async () => {
      cacheService.exists.mockResolvedValue(false);
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        expiresAt: new Date(Date.now() + 100000),
        user: { ...mockUser, isActive: false },
      });

      await expect(
        service.refreshTokens({ refreshToken: 'token-abc' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return new tokens on valid refresh', async () => {
      cacheService.exists.mockResolvedValue(false);
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 100000),
        user: mockUser,
      });
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.delete.mockResolvedValue({});
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.create.mockResolvedValue({});

      const result = await service.refreshTokens({ refreshToken: 'token-abc' });
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
    });
  });

  describe('logout', () => {
    it('should blacklist and delete token if found', async () => {
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        expiresAt: new Date(Date.now() + 100000),
      });
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.delete.mockResolvedValue({});

      await service.logout('user-1', 'token-abc');

      expect(cacheService.set).toHaveBeenCalled();
      expect(
        (prisma.baseClient as Record<string, Record<string, jest.Mock>>)
          .refreshToken.delete,
      ).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
      });
    });

    it('should do nothing if token not found', async () => {
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).refreshToken.findFirst.mockResolvedValue(null);

      await service.logout('user-1', 'token-abc');

      expect(cacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('should throw if user not found', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'old',
          newPassword: 'New1password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if current password is wrong', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong',
          newPassword: 'New1password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should update password on valid current password', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      await service.changePassword('user-1', {
        currentPassword: 'old',
        newPassword: 'New1password',
      });

      expect(
        (prisma.baseClient as Record<string, Record<string, jest.Mock>>).user
          .update,
      ).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'new-hash' },
      });
    });
  });

  describe('forgotPassword', () => {
    it('should silently return if user not found (no email enumeration)', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'missing@test.com' }),
      ).resolves.toBeUndefined();
      expect(queueProducer.publish).not.toHaveBeenCalled();
    });

    it('should create reset token and publish queue event', async () => {
      (
        prisma.client as Record<string, Record<string, jest.Mock>>
      ).user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).passwordResetToken.create.mockResolvedValue({});

      await service.forgotPassword({ email: 'test@example.com' });

      expect(
        (prisma.baseClient as Record<string, Record<string, jest.Mock>>)
          .passwordResetToken.create,
      ).toHaveBeenCalled();
      expect(queueProducer.publish).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should throw if reset token not found or expired', async () => {
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).passwordResetToken.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'bad-token', newPassword: 'New1pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should update password and mark token as used', async () => {
      (
        prisma.baseClient as Record<string, Record<string, jest.Mock>>
      ).passwordResetToken.findFirst.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        tokenHash: 'hash',
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      await service.resetPassword({
        token: 'valid-token',
        newPassword: 'New1pass',
      });

      expect(prisma.transaction).toHaveBeenCalled();
    });
  });
});
