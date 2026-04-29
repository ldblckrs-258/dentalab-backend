import {
  BCRYPT_ROUNDS,
  CACHE_DOMAIN_AUTH,
  CACHE_KEY_BLACKLIST,
  CACHE_KEY_LOGIN_ATTEMPTS,
  REFRESH_TOKEN_BYTES,
} from '@common/constants';
import type { JwtPayload } from '@common/interfaces';
import { hashToken, t } from '@common/utils';
import { AppConfigService } from '@modules/config';
import { PrismaService } from '@modules/database';
import type { EmailSendResetPasswordPayload } from '@modules/queue';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { CacheService } from '@modules/redis';
import { StorageService } from '@modules/storage';
import { AuditService } from '@modules/audit/audit.service';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { I18nContext } from 'nestjs-i18n';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { RefreshTokenDto } from './dto/refresh-token.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';

// Fields needed when returning user info from auth endpoints
const USER_AUTH_SELECT = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  passwordHash: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly cacheService: CacheService,
    private readonly queueProducer: QueueProducerService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const lockoutKey = `${CACHE_KEY_LOGIN_ATTEMPTS}:${dto.email.toLowerCase()}`;
    const lockoutDurationSeconds =
      this.config.app.LOCKOUT_DURATION_MINUTES * 60;

    // Check lockout before DB query to prevent user enumeration
    const currentAttempts = await this.cacheService.get<number>(
      CACHE_DOMAIN_AUTH,
      lockoutKey,
    );
    if (
      currentAttempts !== null &&
      currentAttempts >= this.config.app.MAX_LOGIN_ATTEMPTS
    ) {
      throw new HttpException(
        t(
          'auth.account_locked',
          'Account temporarily locked. Please try again later.',
        ),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: USER_AUTH_SELECT,
    });

    if (!user) {
      await this.cacheService.increment(
        CACHE_DOMAIN_AUTH,
        lockoutKey,
        lockoutDurationSeconds,
      );
      throw new UnauthorizedException(
        t('auth.invalid_credentials', 'Invalid credentials'),
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException(
        t('auth.account_deactivated', 'Account is deactivated'),
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      await this.cacheService.increment(
        CACHE_DOMAIN_AUTH,
        lockoutKey,
        lockoutDurationSeconds,
      );
      throw new UnauthorizedException(
        t('auth.invalid_credentials', 'Invalid credentials'),
      );
    }

    // Reset counter on successful login
    await this.cacheService.del(CACHE_DOMAIN_AUTH, lockoutKey);

    const { accessToken, refreshToken, refreshExpiresIn } =
      await this.generateTokens(user.id, user.email);

    this.auditService.emit({
      code: 'AUTH_LOGIN_SUCCESS',
      actorId: user.id,
      actorEmail: user.email,
      actorType: 'user',
    });

    return {
      accessToken,
      refreshToken,
      refreshExpiresIn,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    const tokenHash = hashToken(dto.refreshToken);

    // Check Redis blacklist
    const isBlacklisted = await this.cacheService.exists(
      CACHE_DOMAIN_AUTH,
      `${CACHE_KEY_BLACKLIST}:${tokenHash}`,
    );
    if (isBlacklisted) {
      this.auditService.emit({
        code: 'AUTH_REFRESH_TOKEN_REUSE',
        outcome: 'failure',
        actorType: 'user',
        metadata: { tokenHashPrefix: tokenHash.slice(0, 8) },
      });
      throw new UnauthorizedException(
        t('auth.token_revoked', 'Token has been revoked'),
      );
    }

    // Find token in DB with only needed user fields
    const storedToken = await this.prisma.baseClient.refreshToken.findFirst({
      where: {
        tokenHash: tokenHash,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, isActive: true },
        },
      },
    });

    if (!storedToken || !storedToken.user.isActive) {
      throw new UnauthorizedException(
        t('auth.refresh_token_invalid', 'Invalid or expired refresh token'),
      );
    }

    // Blacklist old token + delete from DB in parallel
    await this.blacklistAndDeleteToken(
      storedToken.id,
      tokenHash,
      storedToken.expiresAt,
    );

    // Generate new token pair
    const { accessToken, refreshToken, refreshExpiresIn } =
      await this.generateTokens(storedToken.user.id, storedToken.user.email);

    return {
      accessToken,
      refreshToken,
      refreshExpiresIn,
      user: {
        id: storedToken.user.id,
        email: storedToken.user.email,
        fullName: storedToken.user.fullName,
      },
    };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);

    const storedToken = await this.prisma.baseClient.refreshToken.findFirst({
      where: { tokenHash: tokenHash, userId: userId },
      select: { id: true, expiresAt: true },
    });

    if (storedToken) {
      await this.blacklistAndDeleteToken(
        storedToken.id,
        tokenHash,
        storedToken.expiresAt,
      );
    }

    this.auditService.emit({
      code: 'AUTH_LOGOUT',
      actorId: userId,
      actorType: 'user',
    });
  }

  async getProfile(userId: string) {
    // Import PermissionResolverService would create circular dep,
    // so we query user info here and delegate permission resolution
    const [user, permissions] = await Promise.all([
      this.prisma.client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          avatarUrl: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          preferredLanguage: true,
          userRoles: {
            include: { role: { select: { name: true } } },
          },
        },
      }),
      this.resolvePermissionsForProfile(userId),
    ]);

    if (!user) {
      throw new UnauthorizedException(
        t('common.user_not_found', 'User not found'),
      );
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: this.storageService.resolveAvatarUrl(user.avatarUrl),
      isActive: user.isActive,
      roles: user.userRoles.map((ur) => ur.role.name),
      permissions,
      preferredLanguage: user.preferredLanguage,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      throw new UnauthorizedException(
        t('common.user_not_found', 'User not found'),
      );
    }

    const isCurrentValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedException(
        t('auth.current_password_incorrect', 'Current password is incorrect'),
      );
    }

    const newHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.baseClient.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, preferredLanguage: true },
    });

    // Always return success to prevent email enumeration
    if (!user) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.baseClient.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash,
        expiresAt: expiresAt,
      },
    });

    const payload: EmailSendResetPasswordPayload = {
      userId: user.id,
      email: user.email,
      resetToken,
      expiresAt: expiresAt.toISOString(),
      lang: I18nContext.current()?.lang ?? user.preferredLanguage,
    };
    this.queueProducer.publish(ROUTING_KEY.EMAIL_SEND_RESET_PASSWORD, payload);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashToken(dto.token);

    const resetToken =
      await this.prisma.baseClient.passwordResetToken.findFirst({
        where: {
          tokenHash: tokenHash,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

    if (!resetToken) {
      throw new UnauthorizedException(
        t('auth.reset_token_invalid', 'Invalid or expired reset token'),
      );
    }

    const newHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash: newHash },
      });

      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      await tx.refreshToken.deleteMany({
        where: { userId: resetToken.userId },
      });
    });
  }

  // ── Private helpers ──

  private async blacklistAndDeleteToken(
    tokenId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const remainingTtl = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);

    await Promise.all([
      remainingTtl > 0
        ? this.cacheService.set(
            CACHE_DOMAIN_AUTH,
            `${CACHE_KEY_BLACKLIST}:${tokenHash}`,
            true,
            remainingTtl,
          )
        : Promise.resolve(),
      this.prisma.baseClient.refreshToken.delete({ where: { id: tokenId } }),
    ]);
  }

  private async resolvePermissionsForProfile(
    userId: string,
  ): Promise<string[]> {
    const [userRoles, overrides] = await Promise.all([
      this.prisma.baseClient.userRole.findMany({
        where: { userId: userId },
        include: {
          role: {
            include: {
              rolePermissions: {
                include: {
                  permission: {
                    select: { resource: true, action: true, scope: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.baseClient.userPermissionOverride.findMany({
        where: {
          userId: userId,
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: {
          permission: {
            select: { resource: true, action: true, scope: true },
          },
        },
      }),
    ]);

    const buildKey = (p: {
      resource: string;
      action: string;
      scope?: string | null;
    }) =>
      p.scope
        ? `${p.resource}:${p.action}:${p.scope}`
        : `${p.resource}:${p.action}`;

    const permSet = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) {
        permSet.add(buildKey(rp.permission));
      }
    }
    for (const o of overrides) {
      const key = buildKey(o.permission);
      if (o.grantType === 'deny') permSet.delete(key);
      else if (o.grantType === 'grant') permSet.add(key);
    }

    return Array.from(permSet).sort();
  }

  private async generateTokens(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = this.jwtService.sign(payload);

    const refreshToken = crypto
      .randomBytes(REFRESH_TOKEN_BYTES)
      .toString('hex');
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpiryMs = this.parseExpiry(
      this.config.jwt.JWT_REFRESH_EXPIRY,
    );

    await this.prisma.baseClient.refreshToken.create({
      data: {
        userId: userId,
        tokenHash: refreshTokenHash,
        expiresAt: new Date(Date.now() + refreshExpiryMs),
      },
    });

    return { accessToken, refreshToken, refreshExpiresIn: refreshExpiryMs };
  }

  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)(m|h|d)$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;

    const value = parseInt(match[1], 10);
    switch (match[2]) {
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }
}
