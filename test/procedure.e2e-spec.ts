import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('ProcedureController (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let createdProcedureId: string;

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
  });

  afterAll(async () => {
    if (createdProcedureId && adminToken) {
      await request(app.getHttpServer())
        .patch(`/api/v1/procedures/${createdProcedureId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });
    }
    await app.close();
  });

  describe('POST /api/v1/procedures', () => {
    it('should create a procedure when Admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          adaCode: 'D9999',
          name: 'E2E Test Procedure',
          category: 'diagnostic',
          durationMinutes: 15,
          defaultFee: 25.0,
        })
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.adaCode).toBe('D9999');
      createdProcedureId = res.body.data.id;
    });

    it('should return 409 on duplicate adaCode', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          adaCode: 'D9999',
          name: 'Duplicate',
          category: 'diagnostic',
          durationMinutes: 15,
          defaultFee: 25.0,
        })
        .expect(409);
    });

    it('should return 403 when Doctor tries to create', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          adaCode: 'D8888',
          name: 'Doctor Procedure',
          category: 'diagnostic',
          durationMinutes: 15,
          defaultFee: 25.0,
        })
        .expect(403);
    });

    it('should return 403 when Receptionist tries to create', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          adaCode: 'D7777',
          name: 'Receptionist Procedure',
          category: 'diagnostic',
          durationMinutes: 15,
          defaultFee: 25.0,
        })
        .expect(403);
    });
  });

  describe('GET /api/v1/procedures', () => {
    it('should return paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/procedures')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('should include inactive procedures when includeInactive=true', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/procedures?isActive=false')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/v1/procedures/:id', () => {
    it('should return procedure detail', async () => {
      if (!createdProcedureId) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/procedures/${createdProcedureId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.adaCode).toBe('D9999');
    });

    it('should return 404 for non-existent procedure', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/procedures/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/procedures/:id', () => {
    it('should update a procedure', async () => {
      if (!createdProcedureId) return;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/procedures/${createdProcedureId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated E2E Procedure', durationMinutes: 30 })
        .expect(200);

      expect(res.body.data.name).toBe('Updated E2E Procedure');
    });

    it('should disable a procedure', async () => {
      if (!createdProcedureId) return;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/procedures/${createdProcedureId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      expect(res.body.data.isActive).toBe(false);
    });
  });
});
