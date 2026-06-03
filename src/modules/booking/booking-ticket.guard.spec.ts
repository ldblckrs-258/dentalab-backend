import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BookingTicketGuard } from './booking-ticket.guard';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';

const SECRET = 'test-booking-ticket-secret-32ch';

function makeContext(
  authHeader?: string,
  requestExtra: Record<string, unknown> = {},
): ExecutionContext {
  const req: Record<string, unknown> = {
    headers: { authorization: authHeader },
    ...requestExtra,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeVerification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'verif-uuid',
    email: 'user@example.com',
    verifiedAt: new Date(),
    consumedAt: null,
    expiresAt: new Date(Date.now() + 15 * 60_000),
    ...overrides,
  };
}

describe('BookingTicketGuard', () => {
  let guard: BookingTicketGuard;
  let jwt: { verify: jest.Mock };
  let prisma: any;

  const config = {
    booking: { BOOKING_TICKET_SECRET: SECRET },
  } as unknown as AppConfigService;

  beforeEach(() => {
    jwt = { verify: jest.fn() } as any;

    prisma = {
      baseClient: {
        bookingVerification: { findUnique: jest.fn() },
      },
    };

    guard = new BookingTicketGuard(
      jwt as unknown as JwtService,
      prisma as PrismaService,
      config,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('throws when no Authorization header present', async () => {
    const ctx = makeContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when Authorization header is not Bearer scheme', async () => {
    const ctx = makeContext('Basic dXNlcjpwYXNz');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when jwt.verify throws (expired/invalid token)', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('TokenExpiredError');
    });
    const ctx = makeContext('Bearer bad-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when aud is not "booking"', async () => {
    jwt.verify.mockReturnValue({
      sub: 'vid',
      email: 'u@e.com',
      aud: 'staff',
    });
    const ctx = makeContext('Bearer token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when verification row not found', async () => {
    jwt.verify.mockReturnValue({
      sub: 'vid',
      email: 'u@e.com',
      aud: 'booking',
    });
    prisma.baseClient.bookingVerification.findUnique.mockResolvedValue(null);
    const ctx = makeContext('Bearer token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when verifiedAt is null (OTP not yet verified)', async () => {
    jwt.verify.mockReturnValue({
      sub: 'vid',
      email: 'u@e.com',
      aud: 'booking',
    });
    prisma.baseClient.bookingVerification.findUnique.mockResolvedValue(
      makeVerification({ verifiedAt: null }),
    );
    const ctx = makeContext('Bearer token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when consumedAt is set (ticket already used)', async () => {
    jwt.verify.mockReturnValue({
      sub: 'vid',
      email: 'u@e.com',
      aud: 'booking',
    });
    prisma.baseClient.bookingVerification.findUnique.mockResolvedValue(
      makeVerification({ consumedAt: new Date() }),
    );
    const ctx = makeContext('Bearer token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when expiresAt has passed (ticket expired)', async () => {
    jwt.verify.mockReturnValue({
      sub: 'vid',
      email: 'u@e.com',
      aud: 'booking',
    });
    prisma.baseClient.bookingVerification.findUnique.mockResolvedValue(
      makeVerification({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const ctx = makeContext('Bearer token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('returns true and attaches bookingTicket to request for valid ticket', async () => {
    jwt.verify.mockReturnValue({
      sub: 'verif-uuid',
      email: 'user@example.com',
      aud: 'booking',
    });
    prisma.baseClient.bookingVerification.findUnique.mockResolvedValue(
      makeVerification(),
    );

    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer valid-token' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req['bookingTicket']).toEqual({
      verificationId: 'verif-uuid',
      email: 'user@example.com',
    });
  });

  it('accepts aud as array containing "booking"', async () => {
    jwt.verify.mockReturnValue({
      sub: 'verif-uuid',
      email: 'user@example.com',
      aud: ['booking'],
    });
    prisma.baseClient.bookingVerification.findUnique.mockResolvedValue(
      makeVerification(),
    );
    const ctx = makeContext('Bearer token');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
