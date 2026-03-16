import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { KioskAuthGuard } from './kiosk-auth.guard';
import { PrismaService } from '@modules/database';

describe('KioskAuthGuard', () => {
  let guard: KioskAuthGuard;
  let prisma: any;

  const createMockContext = (headers: Record<string, string> = {}) => {
    const request = { headers, kioskSession: undefined };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      request,
    } as unknown as ExecutionContext & { request: any };
  };

  beforeEach(async () => {
    prisma = {
      baseClient: {
        kioskSession: { findFirst: jest.fn() },
      },
    };

    const module = await Test.createTestingModule({
      providers: [KioskAuthGuard, { provide: PrismaService, useValue: prisma }],
    }).compile();

    guard = module.get(KioskAuthGuard);
  });

  it('should throw when token is missing', async () => {
    const ctx = createMockContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw when session not found or expired', async () => {
    prisma.baseClient.kioskSession.findFirst.mockResolvedValue(null);
    const ctx = createMockContext({ 'x-kiosk-token': 'bad-token' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should attach session to request and return true', async () => {
    const mockSession = { id: 'session-1', status: 'active' };
    prisma.baseClient.kioskSession.findFirst.mockResolvedValue(mockSession);
    const ctx = createMockContext({ 'x-kiosk-token': 'valid-token' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect((ctx as any).request.kioskSession).toEqual(mockSession);
  });
});
