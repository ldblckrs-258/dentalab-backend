import {
  BCRYPT_ROUNDS,
  CACHE_DOMAIN_AUTH,
  CACHE_KEY_BLACKLIST,
  CACHE_KEY_LOGIN_ATTEMPTS,
  REFRESH_TOKEN_BYTES,
} from '@common/constants';
import type { JwtPayload } from '@common/interfaces';
import { hashToken } from '@common/utils';
import { AppConfigService } from '@modules/config';
import { PrismaService } from '@modules/database';
import type { EmailSendResetPasswordPayload } from '@modules/queue';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { CacheService } from '@modules/redis';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
  full_name: true,
  is_active: true,
  password_hash: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly cacheService: CacheService,
    private readonly queueProducer: QueueProducerService,
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
        'Account temporarily locked. Please try again later.',
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
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new ForbiddenException('Account is deactivated');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );
    if (!isPasswordValid) {
      await this.cacheService.increment(
        CACHE_DOMAIN_AUTH,
        lockoutKey,
        lockoutDurationSeconds,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset counter on successful login
    await this.cacheService.del(CACHE_DOMAIN_AUTH, lockoutKey);

    const { accessToken, refreshToken, refreshExpiresIn } =
      await this.generateTokens(user.id, user.email);

    return {
      accessToken,
      refreshToken,
      refreshExpiresIn,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
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
      throw new UnauthorizedException('Token has been revoked');
    }

    // Find token in DB with only needed user fields
    const storedToken = await this.prisma.baseClient.refreshToken.findFirst({
      where: {
        token_hash: tokenHash,
        expires_at: { gt: new Date() },
      },
      include: {
        user: {
          select: { id: true, email: true, full_name: true, is_active: true },
        },
      },
    });

    if (!storedToken || !storedToken.user.is_active) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Blacklist old token + delete from DB in parallel
    await this.blacklistAndDeleteToken(
      storedToken.id,
      tokenHash,
      storedToken.expires_at,
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
        fullName: storedToken.user.full_name,
      },
    };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);

    const storedToken = await this.prisma.baseClient.refreshToken.findFirst({
      where: { token_hash: tokenHash, user_id: userId },
      select: { id: true, expires_at: true },
    });

    if (storedToken) {
      await this.blacklistAndDeleteToken(
        storedToken.id,
        tokenHash,
        storedToken.expires_at,
      );
    }
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
          full_name: true,
          phone: true,
          avatar_url: true,
          is_active: true,
          created_at: true,
          updated_at: true,
          user_roles: {
            include: { role: { select: { name: true } } },
          },
        },
      }),
      this.resolvePermissionsForProfile(userId),
    ]);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      isActive: user.is_active,
      roles: user.user_roles.map((ur) => ur.role.name),
      permissions,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, password_hash: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isCurrentValid = await bcrypt.compare(
      dto.currentPassword,
      user.password_hash,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.baseClient.user.update({
      where: { id: userId },
      data: { password_hash: newHash },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true },
    });

    // Always return success to prevent email enumeration
    if (!user) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.baseClient.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });

    const payload: EmailSendResetPasswordPayload = {
      userId: user.id,
      email: user.email,
      resetToken,
      expiresAt: expiresAt.toISOString(),
    };
    this.queueProducer.publish(ROUTING_KEY.EMAIL_SEND_RESET_PASSWORD, payload);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashToken(dto.token);

    const resetToken =
      await this.prisma.baseClient.passwordResetToken.findFirst({
        where: {
          token_hash: tokenHash,
          used_at: null,
          expires_at: { gt: new Date() },
        },
      });

    if (!resetToken) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const newHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.user_id },
        data: { password_hash: newHash },
      });

      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used_at: new Date() },
      });

      await tx.refreshToken.deleteMany({
        where: { user_id: resetToken.user_id },
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
        where: { user_id: userId },
        include: {
          role: {
            include: {
              role_permissions: {
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
          user_id: userId,
          is_active: true,
          OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
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
      for (const rp of ur.role.role_permissions) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        permSet.add(buildKey(rp.permission));
      }
    }
    for (const o of overrides) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const key = buildKey(o.permission);
      if (o.grant_type === 'deny') permSet.delete(key);
      else if (o.grant_type === 'grant') permSet.add(key);
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
        user_id: userId,
        token_hash: refreshTokenHash,
        expires_at: new Date(Date.now() + refreshExpiryMs),
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
