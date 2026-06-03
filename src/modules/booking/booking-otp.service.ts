import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '@modules/database';
import { CacheService } from '@modules/redis';
import { EmailService } from '@modules/email';
import { AppConfigService } from '@modules/config';
import { SYSTEM_TEMPLATES } from '@modules/email/email.constants';

const OTP_EXPIRY_MINUTES = 10;
const OTP_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS_REDIS = 10;
const REDIS_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const MAX_ROW_ATTEMPTS = 5;
const TICKET_EXPIRY = '15m';
const TICKET_EXPIRY_MS = 15 * 60_000;

export interface BookingTicketPayload {
  sub: string;
  email: string;
}

export interface VerifyOtpResult {
  bookingTicket: string;
  patient?: { firstName: string; lastName: string; phone: string };
}

function hashOtp(code: string, pepper: string): string {
  return createHash('sha256')
    .update(code + pepper)
    .digest('hex');
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

@Injectable()
export class BookingOtpService {
  private readonly logger = new Logger(BookingOtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly email: EmailService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async request(emailRaw: string, ip: string): Promise<void> {
    const emailLower = emailRaw.toLowerCase();

    const cooldownKey = `cooldown:${emailLower}`;
    const hasCooldown = await this.cache.exists('booking_otp', cooldownKey);
    if (hasCooldown) {
      return;
    }

    const digits = String(Math.floor(100_000 + Math.random() * 900_000));
    const pepper = this.config.booking.BOOKING_OTP_PEPPER;
    const otpHash = hashOtp(digits, pepper);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

    await this.prisma.baseClient.bookingVerification.create({
      data: {
        email: emailLower,
        otpHash,
        expiresAt,
        attempts: 0,
        ipAddress: ip,
      },
    });

    await this.cache.set('booking_otp', cooldownKey, 1, OTP_COOLDOWN_SECONDS);

    try {
      await this.email.sendTemplatedEmail({
        to: emailLower,
        templateName: SYSTEM_TEMPLATES.BOOKING_OTP,
        variables: { code: digits, expiresInMinutes: OTP_EXPIRY_MINUTES },
        entityType: 'system',
      });
    } catch (err) {
      this.logger.warn(
        `OTP email send failed for ${emailLower}: ${(err as Error).message}`,
      );
    }
  }

  async verify(
    emailRaw: string,
    code: string,
  ): Promise<VerifyOtpResult | null> {
    const emailLower = emailRaw.toLowerCase();
    const pepper = this.config.booking.BOOKING_OTP_PEPPER;

    const attemptKey = emailLower;
    const attemptCount = await this.cache.increment(
      'booking_otp_verify_attempts',
      attemptKey,
      REDIS_ATTEMPT_WINDOW_SECONDS,
    );
    if (attemptCount > MAX_VERIFY_ATTEMPTS_REDIS) {
      hashOtp(code, pepper);
      return null;
    }

    const row = await this.prisma.baseClient.bookingVerification.findFirst({
      where: {
        email: { equals: emailLower, mode: 'insensitive' },
        verifiedAt: null,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) {
      timingSafeCompare(hashOtp(code, pepper), hashOtp('000000', pepper));
      return null;
    }

    const newAttempts = row.attempts + 1;
    if (newAttempts > MAX_ROW_ATTEMPTS) {
      await this.prisma.baseClient.bookingVerification.update({
        where: { id: row.id },
        data: { attempts: newAttempts, expiresAt: new Date(0) },
      });
      return null;
    }

    await this.prisma.baseClient.bookingVerification.update({
      where: { id: row.id },
      data: { attempts: newAttempts },
    });

    const expectedHash = hashOtp(code, pepper);
    const isValid = timingSafeCompare(row.otpHash, expectedHash);
    if (!isValid) {
      return null;
    }

    // On verify, extend expiresAt to the ticket TTL so the DB row's expiry tracks
    // the issued JWT (the guard enforces it as a second factor / revocation hook).
    await this.prisma.baseClient.bookingVerification.update({
      where: { id: row.id },
      data: {
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + TICKET_EXPIRY_MS),
      },
    });

    const ticketPayload: Omit<BookingTicketPayload, 'sub'> = {
      email: emailLower,
    };
    const bookingTicket = this.jwt.sign(ticketPayload, {
      subject: row.id,
      audience: 'booking',
      expiresIn: TICKET_EXPIRY,
    });

    const patients = await this.prisma.baseClient.patient.findMany({
      where: {
        email: { equals: emailLower, mode: 'insensitive' },
        deletedAt: null,
        isActive: true,
      },
      select: { firstName: true, lastName: true, phone: true },
    });

    const patient =
      patients.length === 1
        ? {
            firstName: patients[0].firstName,
            lastName: patients[0].lastName,
            phone: patients[0].phone ?? '',
          }
        : undefined;

    return { bookingTicket, patient };
  }
}
