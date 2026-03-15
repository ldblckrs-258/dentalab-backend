import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import type { AppConfigService } from '@modules/config';
import type { PrismaService } from '@modules/database';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { client: { user: { findUnique: jest.Mock } } };

  beforeEach(() => {
    prisma = {
      client: {
        user: { findUnique: jest.fn() },
      },
    };

    const config = { jwt: { JWT_SECRET: 'test-secret' } } as AppConfigService;
    strategy = new JwtStrategy(config, prisma as unknown as PrismaService);
  });

  it('should return AuthenticatedUser for valid active user', async () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      full_name: 'Test',
      is_active: true,
    };
    prisma.client.user.findUnique.mockResolvedValue(user);

    const result = await strategy.validate({
      sub: 'user-1',
      email: 'test@example.com',
    });
    expect(result).toEqual({
      id: 'user-1',
      email: 'test@example.com',
      fullName: 'Test',
      isActive: true,
    });
  });

  it('should throw UnauthorizedException if user not found', async () => {
    prisma.client.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'missing', email: 'x@y.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if user is inactive', async () => {
    prisma.client.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      full_name: 'Test',
      is_active: false,
    });

    await expect(
      strategy.validate({ sub: 'user-1', email: 'test@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
