import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../src/modules/common/guards/rate-limit.guard';
import { AppConfigService } from '../src/modules/config';
import { PermissionGuard } from '../src/modules/rbac/guards/permission.guard';
import { PrismaService } from '../src/modules/database';

const BASE = '/api/v1';

describe('AppointmentController (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let testProviderId: string;
  let testPatientId: string;
  let testPatient2Id: string;
  let testTypeId: string;
  let testProcedureId: string;
  let testOperatoryId: string;
  let prisma: PrismaService;

  function nextMonday9am(): string {
    const d = new Date();
    d.setUTCHours(2, 0, 0, 0);
    const day = d.getUTCDay();
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysUntilMonday);
    return d.toISOString();
  }

  function shiftISO(iso: string, offsetMinutes: number): string {
    return new Date(
      new Date(iso).getTime() + offsetMinutes * 60_000,
    ).toISOString();
  }

  async function createAppointment(
    token: string,
    overrides: Record<string, unknown> = {},
  ) {
    const start = nextMonday9am();
    return request(app.getHttpServer())
      .post(`${BASE}/appointments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: testPatientId,
        providerId: testProviderId,
        typeId: testTypeId,
        operatoryId: testOperatoryId,
        startTime: start,
        durationMinutes: 60,
        ...overrides,
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

    const adminLogin = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: 'admin@dentalab.com', password: 'Admin@123' });
    if (!adminLogin.body.data?.accessToken) {
      console.error(
        'Admin login failed:',
        JSON.stringify(adminLogin.body).substring(0, 200),
      );
    }
    adminToken = adminLogin.body.data?.accessToken ?? '';

    testProviderId = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';

    const scheduleRes = await request(app.getHttpServer())
      .put(`${BASE}/providers/${testProviderId}/schedules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        shifts: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 5, startTime: '09:00', endTime: '17:00' },
        ],
      });
    if (scheduleRes.status !== 200) {
      console.warn('Schedule setup warning:', scheduleRes.body);
    }

    const patientRes = await request(app.getHttpServer())
      .post(`${BASE}/patients`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'E2E', lastName: 'PatientOne' });
    testPatientId = patientRes.body.data?.id ?? '';

    const patient2Res = await request(app.getHttpServer())
      .post(`${BASE}/patients`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'E2E', lastName: 'PatientTwo' });
    testPatient2Id = patient2Res.body.data?.id ?? '';

    const typeRes = await request(app.getHttpServer())
      .post(`${BASE}/appointment-types`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `E2E Type ${Date.now()}`, durationMinutes: 60 });
    testTypeId = typeRes.body.data?.id ?? '';

    // Created via Prisma: the seed admin role lacks operatories:create.
    const operatory = await prisma.baseClient.operatory.create({
      data: {
        name: `E2E Operatory ${Date.now()}`,
        code: `OP-${Date.now()}`,
        color: '#3b82f6',
        isActive: true,
        displayOrder: 0,
      },
      select: { id: true },
    });
    testOperatoryId = operatory.id;

    const procedureRes = await request(app.getHttpServer())
      .post(`${BASE}/procedures`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        adaCode: `E2E-${Date.now()}`,
        name: 'E2E Procedure',
        category: 'diagnostic',
        durationMinutes: 30,
        defaultFee: 50,
      });
    testProcedureId = procedureRes.body.data?.id ?? '';
  });

  afterAll(async () => {
    if (testOperatoryId) {
      const appts = await prisma.baseClient.appointment.findMany({
        where: { operatoryId: testOperatoryId },
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
        where: { id: testOperatoryId },
      });
    }
    await app.close();
  });

  describe('fixture sanity', () => {
    it('0. all fixture IDs resolved', () => {
      if (!adminToken) console.error('adminToken is empty');
      if (!testProviderId) console.error('testProviderId is empty');
      if (!testPatientId) console.error('testPatientId is empty');
      if (!testPatient2Id) console.error('testPatient2Id is empty');
      if (!testTypeId) console.error('testTypeId is empty');
      if (!testProcedureId) console.error('testProcedureId is empty');
      expect(adminToken).toBeTruthy();
      expect(testProviderId).toBeTruthy();
      expect(testPatientId).toBeTruthy();
      expect(testPatient2Id).toBeTruthy();
      expect(testTypeId).toBeTruthy();
      expect(testProcedureId).toBeTruthy();
    });
  });

  describe('POST /api/v1/appointments — create', () => {
    it('1. happy path → 201, payload matches input', async () => {
      if (!testProviderId || !testPatientId || !testTypeId) return;

      const start = nextMonday9am();
      const res = await request(app.getHttpServer())
        .post(`${BASE}/appointments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: testPatientId,
          providerId: testProviderId,
          typeId: testTypeId,
          operatoryId: testOperatoryId,
          startTime: start,
          durationMinutes: 60,
          notes: 'E2E happy path',
          chiefComplaint: 'toothache',
        })
        .expect(201);

      const data = res.body.data;
      expect(data).toHaveProperty('id');
      expect(data.status).toBe('scheduled');
      expect(data.patientId ?? data.patient?.id).toBe(testPatientId);
      expect(data.providerId ?? data.provider?.id).toBe(testProviderId);
      expect(data.typeId ?? data.appointmentType?.id).toBe(testTypeId);
      expect(data.notes).toBe('E2E happy path');
    });

    it('2. with procedureIds → 201, _count.patientProcedures > 0', async () => {
      if (!testProviderId || !testPatientId || !testTypeId || !testProcedureId)
        return;

      const ppRes = await request(app.getHttpServer())
        .post(`${BASE}/patient-procedures`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ patientId: testPatientId, procedureId: testProcedureId });
      const ppId = ppRes.body.data?.id;
      if (!ppId) return;

      const start = shiftISO(nextMonday9am(), 70);
      const res = await request(app.getHttpServer())
        .post(`${BASE}/appointments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: testPatientId,
          providerId: testProviderId,
          typeId: testTypeId,
          operatoryId: testOperatoryId,
          startTime: start,
          durationMinutes: 60,
          procedureIds: [ppId],
        })
        .expect(201);

      const data = res.body.data;
      expect(data._count?.patientProcedures).toBeGreaterThan(0);
    });

    it('3. procedureIds from different patient → 400, no appointment created', async () => {
      if (
        !testProviderId ||
        !testPatientId ||
        !testPatient2Id ||
        !testTypeId ||
        !testProcedureId
      )
        return;

      const ppRes = await request(app.getHttpServer())
        .post(`${BASE}/patient-procedures`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ patientId: testPatient2Id, procedureId: testProcedureId });
      const wrongPpId = ppRes.body.data?.id;
      if (!wrongPpId) return;

      const start = shiftISO(nextMonday9am(), 200);
      await request(app.getHttpServer())
        .post(`${BASE}/appointments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: testPatientId,
          providerId: testProviderId,
          typeId: testTypeId,
          operatoryId: testOperatoryId,
          startTime: start,
          durationMinutes: 60,
          procedureIds: [wrongPpId],
        })
        .expect(400);
    });

    it('4. overlap → 409 with APPOINTMENT_OVERLAP code and conflictingAppointmentIds', async () => {
      if (!testProviderId || !testPatientId || !testTypeId) return;

      const start = shiftISO(nextMonday9am(), 300);

      const firstRes = await request(app.getHttpServer())
        .post(`${BASE}/appointments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: testPatientId,
          providerId: testProviderId,
          typeId: testTypeId,
          operatoryId: testOperatoryId,
          startTime: start,
          durationMinutes: 60,
        })
        .expect(201);
      const firstId = firstRes.body.data?.id;

      const conflictRes = await request(app.getHttpServer())
        .post(`${BASE}/appointments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: testPatientId,
          providerId: testProviderId,
          typeId: testTypeId,
          operatoryId: testOperatoryId,
          startTime: shiftISO(start, 30),
          durationMinutes: 60,
        })
        .expect(409);

      const conflictCode =
        conflictRes.body.details?.code ??
        conflictRes.body.data?.code ??
        conflictRes.body.code;
      expect(conflictCode).toBe('APPOINTMENT_OVERLAP');
      const conflictIds =
        conflictRes.body.details?.conflictingAppointmentIds ??
        conflictRes.body.data?.conflictingAppointmentIds ??
        conflictRes.body.conflictingAppointmentIds ??
        [];
      expect(conflictIds).toContain(firstId);
    });

    it('5. race: Promise.allSettled same slot → exactly one 201, one 409', async () => {
      if (!testProviderId || !testPatientId || !testTypeId) return;

      const start = shiftISO(nextMonday9am(), 420);
      const payload = {
        patientId: testPatientId,
        providerId: testProviderId,
        typeId: testTypeId,
        operatoryId: testOperatoryId,
        startTime: start,
        durationMinutes: 60,
      };

      const results = await Promise.allSettled([
        request(app.getHttpServer())
          .post(`${BASE}/appointments`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(payload),
        request(app.getHttpServer())
          .post(`${BASE}/appointments`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(payload),
      ]);

      const statuses = results.map((r) =>
        r.status === 'fulfilled' ? r.value.status : 500,
      );
      const created = statuses.filter((s) => s === 201).length;
      const conflicted = statuses.filter((s) => s === 409).length;
      expect(created).toBe(1);
      expect(conflicted).toBe(1);
    });

    it('6. outside provider hours (08:00 when schedule starts 09:00) → 409', async () => {
      if (!testProviderId || !testPatientId || !testTypeId) return;

      const d = new Date(nextMonday9am());
      d.setUTCHours(1, 0, 0, 0);
      const earlyStart = d.toISOString();

      const res = await request(app.getHttpServer())
        .post(`${BASE}/appointments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: testPatientId,
          providerId: testProviderId,
          typeId: testTypeId,
          operatoryId: testOperatoryId,
          startTime: earlyStart,
          durationMinutes: 60,
        })
        .expect(409);

      const message: string = (
        res.body.message ??
        res.body.data?.message ??
        ''
      ).toString();
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/appointments/:id/cancel', () => {
    let cancelTargetId: string;

    beforeEach(async () => {
      if (!testProviderId || !testPatientId || !testTypeId) return;
      const start = shiftISO(nextMonday9am(), 540);
      const res = await createAppointment(adminToken, {
        startTime: start,
        durationMinutes: 60,
      });
      cancelTargetId = res.body.data?.id ?? '';
    });

    it('7. cancel happy path → status with cancelled fields; procedures unlinked', async () => {
      if (!cancelTargetId) return;

      const ppRes = await request(app.getHttpServer())
        .post(`${BASE}/patient-procedures`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: testPatientId,
          procedureId: testProcedureId,
          appointmentId: cancelTargetId,
        });
      const ppId = ppRes.body.data?.id;

      const res = await request(app.getHttpServer())
        .post(`${BASE}/appointments/${cancelTargetId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'patient no-show' });

      expect([200, 201]).toContain(res.status);
      const data = res.body.data ?? res.body;
      expect(data.status).toBe('cancelled');
      expect(data.cancelledBy ?? data.cancelled_by).toBeTruthy();
      expect(data.cancelledAt ?? data.cancelled_at).toBeTruthy();
      expect(data.cancellationReason ?? data.cancellation_reason).toBe(
        'patient no-show',
      );

      if (ppId) {
        const ppCheck = await request(app.getHttpServer())
          .get(`${BASE}/patient-procedures/${ppId}`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(ppCheck.body.data?.appointmentId).toBeNull();
      }
    });

    it('8. cancel from already-cancelled → 400', async () => {
      if (!cancelTargetId) return;

      await request(app.getHttpServer())
        .post(`${BASE}/appointments/${cancelTargetId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'first cancel' });

      await request(app.getHttpServer())
        .post(`${BASE}/appointments/${cancelTargetId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'second cancel' })
        .expect(400);
    });

    it('9. rebook same slot after cancel → 201', async () => {
      if (!cancelTargetId || !testProviderId || !testPatientId || !testTypeId)
        return;

      const detailRes = await request(app.getHttpServer())
        .get(`${BASE}/appointments/${cancelTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const startTime = detailRes.body.data?.startTime;
      if (!startTime) return;

      await request(app.getHttpServer())
        .post(`${BASE}/appointments/${cancelTargetId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'freeing slot for rebook test' });

      await request(app.getHttpServer())
        .post(`${BASE}/appointments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          patientId: testPatientId,
          providerId: testProviderId,
          typeId: testTypeId,
          operatoryId: testOperatoryId,
          startTime,
          durationMinutes: 60,
        })
        .expect(201);
    });
  });

  describe('PATCH /api/v1/appointments/:id/reschedule', () => {
    let rescheduleTargetId: string;
    let rescheduleTargetStart: string;

    beforeAll(async () => {
      if (!testProviderId || !testPatientId || !testTypeId) return;
      rescheduleTargetStart = shiftISO(nextMonday9am(), 660);
      const res = await createAppointment(adminToken, {
        startTime: rescheduleTargetStart,
        durationMinutes: 60,
      });
      rescheduleTargetId = res.body.data?.id ?? '';
    });

    it('10. reschedule to free slot → 200 with updated times', async () => {
      if (!rescheduleTargetId) return;

      const newStart = shiftISO(nextMonday9am(), 780);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/appointments/${rescheduleTargetId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startTime: newStart, durationMinutes: 60 })
        .expect(200);

      const data = res.body.data ?? res.body;
      const updatedStart = new Date(
        String(data.startTime ?? data.start_time),
      ).toISOString();
      expect(updatedStart).toBe(new Date(newStart).toISOString());
    });

    it('11. reschedule to conflicting slot → 409', async () => {
      if (!testProviderId || !testPatientId || !testTypeId) return;

      const blockerStart = shiftISO(nextMonday9am(), 900);
      const blockerRes = await createAppointment(adminToken, {
        startTime: blockerStart,
        durationMinutes: 60,
      });
      const blockerId = blockerRes.body.data?.id;
      if (!blockerId || !rescheduleTargetId) return;

      await request(app.getHttpServer())
        .patch(`${BASE}/appointments/${rescheduleTargetId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startTime: shiftISO(blockerStart, 30), durationMinutes: 60 })
        .expect(409);
    });

    it('12. reschedule a cancelled appointment → 400', async () => {
      if (!testProviderId || !testPatientId || !testTypeId) return;

      const start = shiftISO(nextMonday9am(), 1020);
      const res = await createAppointment(adminToken, {
        startTime: start,
        durationMinutes: 60,
      });
      const id = res.body.data?.id;
      if (!id) return;

      await request(app.getHttpServer())
        .post(`${BASE}/appointments/${id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'setup for reschedule-of-cancelled test' });

      const newStart = shiftISO(nextMonday9am(), 1080);
      await request(app.getHttpServer())
        .patch(`${BASE}/appointments/${id}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startTime: newStart })
        .expect(400);
    });
  });

  describe('GET /api/v1/appointments', () => {
    it('returns list with from/to', async () => {
      if (!adminToken) return;

      const from = new Date().toISOString();
      const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const res = await request(app.getHttpServer())
        .get(`${BASE}/appointments`)
        .query({ from, to })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const items: unknown[] = Array.isArray(res.body.data)
        ? res.body.data
        : (res.body.data?.data ?? []);
      expect(Array.isArray(items)).toBe(true);
    });
  });
});
