import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { BookingOtpService } from './booking-otp.service';
import { PrismaService } from '@modules/database';
import { CacheService } from '@modules/redis';
import { EmailService } from '@modules/email';
import { AppConfigService } from '@modules/config';

const PEPPER = 'test-pepper-min-16ch';

function hashOtp(code: string, pepper: string): string {
  return createHash('sha256')
    .update(code + pepper)
    .digest('hex');
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-id',
    email: 'user@example.com',
    otpHash: hashOtp('123456', PEPPER),
    expiresAt: new Date(Date.now() + 10 * 60_000),
    attempts: 0,
    verifiedAt: null,
    consumedAt: null,
    ipAddress: '127.0.0.1',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('BookingOtpService', () => {
  let service: BookingOtpService;
  let prisma: any;
  let cache: { exists: jest.Mock; set: jest.Mock; increment: jest.Mock };
  let email: { sendTemplatedEmail: jest.Mock };
  let jwt: { sign: jest.Mock };

  beforeEach(async () => {
    prisma = {
      baseClient: {
        bookingVerification: {
          create: jest.fn(),
          findFirst: jest.fn(),
          update: jest.fn(),
        },
        patient: { findMany: jest.fn() },
      },
    };

    cache = {
      exists: jest.fn().mockResolvedValue(false),
      set: jest.fn().mockResolvedValue(undefined),
      increment: jest.fn().mockResolvedValue(1),
    } as any;

    email = { sendTemplatedEmail: jest.fn().mockResolvedValue({}) } as any;

    jwt = { sign: jest.fn().mockReturnValue('mock-ticket') } as any;

    const config = {
      booking: { BOOKING_TICKET_SECRET: 'secret', BOOKING_OTP_PEPPER: PEPPER },
    };

    const module = await Test.createTestingModule({
      providers: [
        BookingOtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: EmailService, useValue: email },
        { provide: JwtService, useValue: jwt },
        { provide: AppConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(BookingOtpService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('request()', () => {
    it('creates a BookingVerification row with hashed+peppered code', async () => {
      prisma.baseClient.bookingVerification.create.mockResolvedValue({});

      await service.request('User@Example.com', '1.2.3.4');

      const callArg =
        prisma.baseClient.bookingVerification.create.mock.calls[0][0];
      expect(callArg.data.email).toBe('user@example.com');
      expect(callArg.data.otpHash).toMatch(/^[a-f0-9]{64}$/);
      expect(callArg.data.ipAddress).toBe('1.2.3.4');
    });

    it('sets expiresAt ~10 minutes from now', async () => {
      prisma.baseClient.bookingVerification.create.mockResolvedValue({});

      await service.request('user@example.com', '1.2.3.4');

      const callArg =
        prisma.baseClient.bookingVerification.create.mock.calls[0][0];
      const diffMs = callArg.data.expiresAt.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(9 * 60_000);
      expect(diffMs).toBeLessThan(11 * 60_000);
    });

    it('sends OTP email directly (not via queue)', async () => {
      prisma.baseClient.bookingVerification.create.mockResolvedValue({});

      await service.request('user@example.com', '127.0.0.1');

      expect(email.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          templateName: 'booking-otp',
          entityType: 'system',
        }),
      );
    });

    it('returns generically even when email send throws (swallows error)', async () => {
      prisma.baseClient.bookingVerification.create.mockResolvedValue({});
      email.sendTemplatedEmail.mockRejectedValue(new Error('SMTP down'));

      await expect(
        service.request('user@example.com', '1.2.3.4'),
      ).resolves.toBeUndefined();
    });

    it('suppresses second mint within cooldown window', async () => {
      cache.exists.mockResolvedValue(true);

      await service.request('user@example.com', '1.2.3.4');

      expect(
        prisma.baseClient.bookingVerification.create,
      ).not.toHaveBeenCalled();
    });

    it('lowercases email before storing', async () => {
      prisma.baseClient.bookingVerification.create.mockResolvedValue({});

      await service.request('UPPER@EXAMPLE.COM', '1.2.3.4');

      const callArg =
        prisma.baseClient.bookingVerification.create.mock.calls[0][0];
      expect(callArg.data.email).toBe('upper@example.com');
    });
  });

  describe('verify()', () => {
    it('returns null with constant-time path when no pending row exists', async () => {
      prisma.baseClient.bookingVerification.findFirst.mockResolvedValue(null);

      const result = await service.verify('user@example.com', '999999');

      expect(result).toBeNull();
    });

    it('returns null when code does not match hash', async () => {
      prisma.baseClient.bookingVerification.findFirst.mockResolvedValue(
        makeRow(),
      );
      prisma.baseClient.bookingVerification.update.mockResolvedValue({});
      prisma.baseClient.patient.findMany.mockResolvedValue([]);

      const result = await service.verify('user@example.com', '000000');

      expect(result).toBeNull();
    });

    it('returns bookingTicket + no prefill on success when no patient matches', async () => {
      prisma.baseClient.bookingVerification.findFirst.mockResolvedValue(
        makeRow(),
      );
      prisma.baseClient.bookingVerification.update.mockResolvedValue({});
      prisma.baseClient.patient.findMany.mockResolvedValue([]);

      const result = await service.verify('user@example.com', '123456');

      expect(result).not.toBeNull();
      expect(result!.bookingTicket).toBe('mock-ticket');
      expect(result!.patient).toBeUndefined();
    });

    it('prefills patient when exactly one active patient matches email', async () => {
      prisma.baseClient.bookingVerification.findFirst.mockResolvedValue(
        makeRow(),
      );
      prisma.baseClient.bookingVerification.update.mockResolvedValue({});
      prisma.baseClient.patient.findMany.mockResolvedValue([
        { firstName: 'Jane', lastName: 'Doe', phone: '0901000001' },
      ]);

      const result = await service.verify('user@example.com', '123456');

      expect(result!.patient).toEqual({
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '0901000001',
      });
    });

    it('returns no prefill when more than one patient matches (ambiguous)', async () => {
      prisma.baseClient.bookingVerification.findFirst.mockResolvedValue(
        makeRow(),
      );
      prisma.baseClient.bookingVerification.update.mockResolvedValue({});
      prisma.baseClient.patient.findMany.mockResolvedValue([
        { firstName: 'Jane', lastName: 'Doe', phone: '0901000001' },
        { firstName: 'Jane', lastName: 'Doe', phone: '0901000002' },
      ]);

      const result = await service.verify('user@example.com', '123456');

      expect(result!.patient).toBeUndefined();
    });

    it('signs ticket with sub=verificationId and aud=booking', async () => {
      const row = makeRow({ id: 'verif-abc' });
      prisma.baseClient.bookingVerification.findFirst.mockResolvedValue(row);
      prisma.baseClient.bookingVerification.update.mockResolvedValue({});
      prisma.baseClient.patient.findMany.mockResolvedValue([]);

      await service.verify('user@example.com', '123456');

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'user@example.com' }),
        expect.objectContaining({ subject: 'verif-abc', audience: 'booking' }),
      );
    });

    it('invalidates row (sets expiresAt past) when attempts exceed 5', async () => {
      const row = makeRow({ attempts: 5 });
      prisma.baseClient.bookingVerification.findFirst.mockResolvedValue(row);
      prisma.baseClient.bookingVerification.update.mockResolvedValue({});

      const result = await service.verify('user@example.com', '123456');

      expect(result).toBeNull();
      const updateCall =
        prisma.baseClient.bookingVerification.update.mock.calls[0][0];
      expect(updateCall.data.expiresAt).toEqual(new Date(0));
    });

    it('blocks after 10 redis attempts regardless of IP', async () => {
      cache.increment.mockResolvedValue(11);

      const result = await service.verify('user@example.com', '123456');

      expect(result).toBeNull();
      expect(
        prisma.baseClient.bookingVerification.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('sets verifiedAt on success', async () => {
      prisma.baseClient.bookingVerification.findFirst.mockResolvedValue(
        makeRow(),
      );
      prisma.baseClient.bookingVerification.update.mockResolvedValue({});
      prisma.baseClient.patient.findMany.mockResolvedValue([]);

      await service.verify('user@example.com', '123456');

      const updateCalls =
        prisma.baseClient.bookingVerification.update.mock.calls;
      const verifiedAtCall = updateCalls.find(
        (c: any[]) => c[0].data.verifiedAt !== undefined,
      );
      expect(verifiedAtCall).toBeDefined();
      expect(verifiedAtCall![0].data.verifiedAt).toBeInstanceOf(Date);
    });
  });
});
