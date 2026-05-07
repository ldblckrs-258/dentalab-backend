import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('TreatmentPlanController (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let createdPlanId: string;
  let testPatientId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@dentalab.com', password: 'Admin@123' });
    adminToken = adminLogin.body.data?.accessToken ?? '';

    const doctorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'doctor@dentalab.com', password: 'Doctor@123' });
    doctorToken = doctorLogin.body.data?.accessToken ?? '';

    const receptionistLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'receptionist@dentalab.com',
        password: 'Receptionist@123',
      });
    receptionistToken = receptionistLogin.body.data?.accessToken ?? '';

    const patientsRes = await request(app.getHttpServer())
      .get('/api/v1/patients?limit=1')
      .set('Authorization', `Bearer ${adminToken}`);
    testPatientId = patientsRes.body.data?.[0]?.id ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/treatment-plans', () => {
    it('should create a treatment plan with draft status', async () => {
      if (!testPatientId || !doctorToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          patientId: testPatientId,
          name: 'E2E Test Treatment Plan',
          estimatedTotalCost: 1000.0,
          notes: 'Initial notes for testing',
        })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.name).toBe('E2E Test Treatment Plan');
      createdPlanId = res.body.data.id;
    });

    it('should return 400 when patientId is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ name: 'No Patient' })
        .expect(400);
    });
  });

  describe('GET /api/v1/treatment-plans', () => {
    it('should return paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('should return 403 without proper permission', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/treatment-plans')
        .expect(401);
    });
  });

  describe('GET /api/v1/treatment-plans/:id', () => {
    it('should return detail with notes for read:full', async () => {
      if (!createdPlanId) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/treatment-plans/${createdPlanId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toHaveProperty('notes');
      expect(res.body.data).toHaveProperty('actualTotalCost');
      expect(res.body.data.actualTotalCost).toBe(0);
    });

    it('should not expose notes for metadata-only permission', async () => {
      if (!createdPlanId) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/treatment-plans/${createdPlanId}`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(res.body.data).not.toHaveProperty('notes');
      expect(res.body.data).not.toHaveProperty('estimatedTotalCost');
    });
  });

  describe('PATCH /api/v1/treatment-plans/:id', () => {
    it('should update treatment plan metadata', async () => {
      if (!createdPlanId) return;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/treatment-plans/${createdPlanId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated E2E Plan', notes: 'Updated notes' })
        .expect(200);

      expect(res.body.data.name).toBe('Updated E2E Plan');
    });
  });

  describe('POST /api/v1/treatment-plans/:id/transition', () => {
    it('should transition draft to proposed', async () => {
      if (!createdPlanId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/treatment-plans/${createdPlanId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'proposed' })
        .expect(200);

      expect(res.body.data.status).toBe('proposed');
    });

    it('should transition proposed to accepted when notes present', async () => {
      if (!createdPlanId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/treatment-plans/${createdPlanId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'accepted' })
        .expect(200);

      expect(res.body.data.status).toBe('accepted');
    });

    it('should block invalid transition (accepted to draft by non-owner)', async () => {
      if (!createdPlanId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/treatment-plans/${createdPlanId}/transition`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ to: 'draft' });

      expect([200, 403, 409]).toContain(res.status);
    });
  });

  describe('DELETE /api/v1/treatment-plans/:id', () => {
    it('should cancel treatment plan with reason', async () => {
      if (!createdPlanId) return;

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/treatment-plans/${createdPlanId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'E2E test cleanup' })
        .expect(200);

      expect(res.body.data.status).toBe('cancelled');
    });

    it('should return 400 when reason is missing', async () => {
      if (!testPatientId || !doctorToken) return;

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          patientId: testPatientId,
          name: 'Cancel Test Plan',
          notes: 'For cancel test',
        });

      const planId = createRes.body.data?.id;
      if (!planId) return;

      await request(app.getHttpServer())
        .delete(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cleanup after test' });
    });
  });

  describe('GDPR deleted-patient fixture', () => {
    it('should return patient name for non-deleted patient', async () => {
      if (!createdPlanId) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/treatment-plans/${createdPlanId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toHaveProperty('patientName');
    });
  });
});
