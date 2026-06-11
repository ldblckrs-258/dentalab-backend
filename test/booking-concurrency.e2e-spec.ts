import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { AppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../src/modules/common/guards/rate-limit.guard';
import { AppConfigService } from '../src/modules/config';
import { PermissionGuard } from '../src/modules/rbac/guards/permission.guard';
import { PrismaService } from '../src/modules/database';

const BASE = '/api/v1';
const PROVIDER_ID = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';

describe('Public Booking — single-transaction guarantees (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let bookingSecret: string;
  let typeId: string;
  let operatoryId: string;

  // A verified, unconsumed BookingVerification + a signed ticket the guard accepts.
  async function mintTicket(
    email: string,
  ): Promise<{ verificationId: string; token: string }> {
    const v = await (prisma.baseClient as any).bookingVerification.create({
      data: {
        email: email.toLowerCase(),
        otpHash: 'e2e-hash',
        expiresAt: new Date(Date.now() + 15 * 60_000),
        verifiedAt: new Date(),
        attempts: 1,
      },
      select: { id: true },
    });
    const token = jwt.sign(
      { email: email.toLowerCase() },
      {
        secret: bookingSecret,
        subject: v.id,
        audience: 'booking',
        expiresIn: '15m',
      },
    );
    return { verificationId: v.id, token };
  }

  // Walk the booking window (tomorrow..+14d) until the slot service returns a slot.
  async function findBookableSlot(): Promise<{ date: string; start: string }> {
    for (let i = 1; i <= 14; i += 1) {
      const d = new Date(Date.now() + i * 86_400_000);
      const date = d.toISOString().substring(0, 10);
      const res = await request(app.getHttpServer())
        .get(`${BASE}/public/booking/slots`)
        .query({ typeId, providerId: PROVIDER_ID, date });
      const slots = res.body?.data?.slots ?? res.body?.slots ?? [];
      if (slots.length > 0) {
        return { date, start: slots[0].start };
      }
    }
    throw new Error('No bookable slot found in the 14-day window');
  }

  function bookSlot(token: string, start: string, email: string) {
    return request(app.getHttpServer())
      .post(`${BASE}/public/booking/appointments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        typeId,
        providerId: PROVIDER_ID,
        startTime: start,
        patient: { firstName: 'E2E', lastName: 'Booker', phone: '0901234567' },
        chiefComplaint: email,
      });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(AppConfigService);
    app.setGlobalPrefix(config.app.API_PREFIX, {
      exclude: ['health/live', 'health/ready'],
    });
    app.useGlobalPipes(
      new AppValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalGuards(
      app.get(RateLimitGuard),
      app.get(JwtAuthGuard),
      app.get(PermissionGuard),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    bookingSecret = config.booking.BOOKING_TICKET_SECRET;

    // Provider schedule Mon–Fri 09:00–17:00 so the slot service yields slots.
    await prisma.baseClient.providerSchedule.deleteMany({
      where: { providerId: PROVIDER_ID },
    });
    for (const dayOfWeek of [1, 2, 3, 4, 5]) {
      await prisma.baseClient.providerSchedule.create({
        data: {
          providerId: PROVIDER_ID,
          dayOfWeek,
          startTime: '09:00',
          endTime: '17:00',
          isAvailable: true,
        },
      });
    }

    // Appointment type the provider is eligible for.
    const type = await prisma.baseClient.appointmentType.create({
      data: {
        name: `E2E Booking Type ${Date.now()}`,
        durationMinutes: 30,
        isActive: true,
      },
      select: { id: true },
    });
    typeId = type.id;
    await (prisma.baseClient as any).providerAppointmentType.create({
      data: { providerId: PROVIDER_ID, appointmentTypeId: typeId },
    });

    // At least one active operatory is required or the slot service returns
    // none (noOperatoriesConfigured).
    const operatory = await prisma.baseClient.operatory.create({
      data: {
        name: `E2E Booking Room ${Date.now()}`,
        code: `BR-${Date.now()}`,
        color: '#3b82f6',
        isActive: true,
        displayOrder: 0,
      },
      select: { id: true },
    });
    operatoryId = operatory.id;
  });

  afterAll(async () => {
    // Clean up everything this suite created so reused DBs don't accumulate rows.
    const appts = await prisma.baseClient.appointment.findMany({
      where: { providerId: PROVIDER_ID },
      select: { id: true },
    });
    const apptIds = appts.map((a) => a.id);
    if (apptIds.length > 0) {
      await prisma.baseClient.appointmentHistory.deleteMany({
        where: { appointmentId: { in: apptIds } },
      });
      await prisma.baseClient.patientProcedure.updateMany({
        where: { appointmentId: { in: apptIds } },
        data: { appointmentId: null },
      });
      await prisma.baseClient.appointment.deleteMany({
        where: { id: { in: apptIds } },
      });
    }
    await prisma.baseClient.operatory.deleteMany({
      where: { id: operatoryId },
    });
    await (prisma.baseClient as any).providerAppointmentType.deleteMany({
      where: { appointmentTypeId: typeId },
    });
    await prisma.baseClient.appointmentType.deleteMany({
      where: { id: typeId },
    });
    await prisma.baseClient.patient.deleteMany({
      where: { email: { contains: '@example.com' } },
    });
    await (prisma.baseClient as any).bookingVerification.deleteMany({
      where: { email: { contains: '@example.com' } },
    });
    await app.close();
  });

  it('concurrent same-slot booking → exactly one 201, one 409, and the loser ticket stays reusable', async () => {
    const slot = await findBookableSlot();
    const a = await mintTicket('race-a@example.com');
    const b = await mintTicket('race-b@example.com');

    const [resA, resB] = await Promise.all([
      bookSlot(a.token, slot.start, 'race-a@example.com'),
      bookSlot(b.token, slot.start, 'race-b@example.com'),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    // The loser's transaction rolled back → its ticket is NOT consumed.
    const winnerIsA = resA.status === 201;
    const loserId = winnerIsA ? b.verificationId : a.verificationId;
    const winnerId = winnerIsA ? a.verificationId : b.verificationId;

    const loser = await (
      prisma.baseClient as any
    ).bookingVerification.findUnique({
      where: { id: loserId },
      select: { consumedAt: true },
    });
    const winner = await (
      prisma.baseClient as any
    ).bookingVerification.findUnique({
      where: { id: winnerId },
      select: { consumedAt: true },
    });

    expect(loser.consumedAt).toBeNull(); // reusable — no re-OTP needed
    expect(winner.consumedAt).not.toBeNull();
  });

  it('a soft-deleted patient email is NOT reused — booking creates a fresh patient', async () => {
    const email = `softdel-${Date.now()}@example.com`;
    const deleted = await prisma.baseClient.patient.create({
      data: {
        firstName: 'Old',
        lastName: 'Deleted',
        email,
        isActive: false,
        deletedAt: new Date(),
      },
      select: { id: true },
    });

    const slot = await findBookableSlot();
    const ticket = await mintTicket(email);
    const res = await bookSlot(ticket.token, slot.start, email);

    expect(res.status).toBe(201);
    const appointmentId =
      res.body?.data?.appointmentId ?? res.body?.appointmentId;
    const appt = await prisma.baseClient.appointment.findUnique({
      where: { id: appointmentId },
      select: { patientId: true },
    });
    expect(appt?.patientId).not.toBe(deleted.id);
  });
});
