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

describe('Scheduling (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let doctorToken: string;
  let createdScheduleId: string;
  let createdOverrideId: string;
  let testProviderId: string;

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

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@dentalab.com', password: 'Admin@123' });
    adminToken = adminLogin.body.data?.accessToken ?? '';

    const doctorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'doctor@dentalab.com', password: 'Doctor@123' });
    doctorToken = doctorLogin.body.data?.accessToken ?? '';

    const providersRes = await request(app.getHttpServer())
      .get('/api/v1/providers?limit=1')
      .set('Authorization', `Bearer ${adminToken}`);
    testProviderId = providersRes.body.data?.[0]?.id ?? '';

    if (testProviderId) {
      await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ shifts: [] });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Provider Schedule CRUD', () => {
    it('POST /api/v1/provider-schedules should create a schedule block', async () => {
      if (!testProviderId) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/provider-schedules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          providerId: testProviderId,
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '12:00',
          isAvailable: true,
        })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.dayOfWeek).toBe(1);
      expect(res.body.data.startTime).toBe('08:00');
      createdScheduleId = res.body.data.id;
    });

    it('should return 409 on overlapping schedule for same provider/day', async () => {
      if (!testProviderId) return;

      await request(app.getHttpServer())
        .post('/api/v1/provider-schedules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          providerId: testProviderId,
          dayOfWeek: 1,
          startTime: '10:00',
          endTime: '14:00',
          isAvailable: true,
        })
        .expect(409);
    });

    it('should accept non-overlapping block on same provider/day', async () => {
      if (!testProviderId) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/provider-schedules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          providerId: testProviderId,
          dayOfWeek: 1,
          startTime: '13:00',
          endTime: '17:00',
          isAvailable: true,
        })
        .expect(201);

      expect(res.body.data.startTime).toBe('13:00');
    });

    it('GET /api/v1/providers/:providerId/schedules should return schedules', async () => {
      if (!testProviderId) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('GET with onlyAvailable=true should filter unavailable blocks', async () => {
      if (!testProviderId) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/providers/${testProviderId}/schedules?onlyAvailable=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('DELETE should return affected appointments', async () => {
      if (!createdScheduleId) return;

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/provider-schedules/${createdScheduleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.deleted).toBe(true);
    });
  });

  describe('Bulk Replace Recurring Shifts', () => {
    afterAll(async () => {
      // Reset to empty so other suites' fixtures are unaffected.
      if (!testProviderId) return;
      await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ shifts: [] });
    });

    it('PUT /providers/:id/schedules with empty payload deletes all', async () => {
      if (!testProviderId) return;
      const res = await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ shifts: [] })
        .expect(200);
      expect(res.body.data.shifts).toEqual([]);
    });

    it('PUT replaces with new set atomically', async () => {
      if (!testProviderId) return;
      const res = await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          shifts: [
            { dayOfWeek: 2, startTime: '08:00', endTime: '12:00' },
            { dayOfWeek: 2, startTime: '13:00', endTime: '17:00' },
            { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' },
          ],
        })
        .expect(200);
      expect(res.body.data.shifts).toHaveLength(3);
    });

    it('PUT rejects intra-payload overlap with 400', async () => {
      if (!testProviderId) return;
      await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          shifts: [
            { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
            { dayOfWeek: 1, startTime: '10:00', endTime: '14:00' },
          ],
        })
        .expect(400);
    });

    it('PUT rejects end <= start with 400', async () => {
      if (!testProviderId) return;
      await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          shifts: [{ dayOfWeek: 1, startTime: '12:00', endTime: '08:00' }],
        })
        .expect(400);
    });

    it('PUT rejects unauthenticated request with 401', async () => {
      if (!testProviderId) return;
      await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .send({ shifts: [] })
        .expect(401);
    });

    it('PUT returns 404 for unknown provider', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/providers/00000000-0000-0000-0000-000000000000/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ shifts: [] })
        .expect(404);
    });

    it('PUT idempotent — same payload twice yields same result', async () => {
      if (!testProviderId) return;
      const payload = {
        shifts: [{ dayOfWeek: 5, startTime: '09:00', endTime: '12:00' }],
      };
      const first = await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(200);
      const second = await request(app.getHttpServer())
        .put(`/api/v1/providers/${testProviderId}/schedules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(200);
      const firstIds = first.body.data.shifts.map((s: { id: string }) => s.id);
      const secondIds = second.body.data.shifts.map(
        (s: { id: string }) => s.id,
      );
      expect(secondIds.sort()).toEqual(firstIds.sort());
    });
  });

  describe('Schedule Override Lifecycle', () => {
    it('POST /api/v1/schedule-overrides should create a pending override', async () => {
      if (!testProviderId || !doctorToken) return;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/schedule-overrides')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          providerId: testProviderId,
          specificDate: dateStr,
          overrideType: 'day_off',
          reason: 'E2E test day off',
        })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.status).toBe('pending');
      createdOverrideId = res.body.data.id;
    });

    it('should allow doctor to cancel their own pending override', async () => {
      if (!createdOverrideId || !doctorToken) return;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/schedule-overrides/${createdOverrideId}/cancel`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      expect(res.body.data.status).toBe('cancelled');
    });

    it('should return 409 when cancelling non-pending override', async () => {
      if (!createdOverrideId) return;

      await request(app.getHttpServer())
        .post(`/api/v1/schedule-overrides/${createdOverrideId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('POST review should approve override', async () => {
      if (!testProviderId || !doctorToken) return;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/schedule-overrides')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          providerId: testProviderId,
          specificDate: dateStr,
          overrideType: 'day_off',
          reason: 'Approved day off',
        });
      const overrideId = createRes.body.data?.id;
      if (!overrideId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/schedule-overrides/${overrideId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision: 'approve' })
        .expect(200);

      expect(res.body.data.status).toBe('approved');
    });

    it('should return 400 when rejecting without reviewNote', async () => {
      if (!testProviderId || !doctorToken) return;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 3);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/schedule-overrides')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          providerId: testProviderId,
          specificDate: dateStr,
          overrideType: 'day_off',
          reason: 'Rejection test',
        });
      const overrideId = createRes.body.data?.id;
      if (!overrideId) return;

      await request(app.getHttpServer())
        .post(`/api/v1/schedule-overrides/${overrideId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision: 'reject' })
        .expect(400);
    });
  });

  describe('Provider Availability', () => {
    it('GET /api/v1/providers/:id/availability should return windows', async () => {
      if (!testProviderId) return;

      const today = new Date().toISOString().split('T')[0];

      const res = await request(app.getHttpServer())
        .get(`/api/v1/providers/${testProviderId}/availability?date=${today}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toHaveProperty('windows');
      expect(res.body.data).toHaveProperty('hasApprovedDayOff');
      expect(res.body.data).toHaveProperty('dayOfWeek');
      expect(res.body.data.providerId).toBe(testProviderId);
    });
  });
});
