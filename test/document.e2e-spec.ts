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
import { StorageService } from '../src/modules/storage';

jest.mock('../src/modules/storage/storage.utils', () => {
  const actual = jest.requireActual('../src/modules/storage/storage.utils');
  const { BadRequestException } = jest.requireActual('@nestjs/common');
  return {
    ...actual,
    validateMagicBytes: jest.fn((buffer: Buffer, declaredMime: string) => {
      const isExe = buffer[0] === 0x4d && buffer[1] === 0x5a;
      if (isExe) {
        throw new BadRequestException('This file type is not supported.');
      }
      const isPdf =
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46;
      if (declaredMime === 'application/pdf' && !isPdf) {
        throw new BadRequestException(
          'File content does not match the declared file type.',
        );
      }
    }),
  };
});

const BASE = '/api/v1';
const TIMESTAMP = Date.now();

const E2E_MANAGER = {
  email: `e2e-doc-manager-${TIMESTAMP}@dentalab.com`,
  password: 'Manager@123',
  fullName: 'E2E Doc Manager',
};

const E2E_DOCTOR = {
  email: `e2e-doc-doctor-${TIMESTAMP}@dentalab.com`,
  password: 'Doctor@123',
  fullName: 'E2E Doc Doctor',
};

const PDF_MAGIC = Buffer.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf,
  0xd3, 0x0a,
]);

const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe('DocumentController + DocumentCategoryController (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let managerToken: string;
  let doctorToken: string;
  let managerId: string;
  let doctorId: string;
  let managerRoleId: string;
  let doctorRoleId: string;
  let hrPermissionId: string;

  let catId: string;
  let docId: string;
  let docBId: string;
  let ver1Id: string;
  let ver2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({
        upload: jest.fn().mockResolvedValue({
          key: `internal-documents/test/${TIMESTAMP}.pdf`,
        }),
        delete: jest.fn().mockResolvedValue(undefined),
        generatePresignedDownloadUrl: jest.fn().mockResolvedValue({
          downloadUrl: `https://mock-storage.test/download/${TIMESTAMP}`,
        }),
        exists: jest.fn().mockResolvedValue(true),
        getPublicUrl: jest.fn(
          (key: string) => `https://mock-storage.test/${key}`,
        ),
        isStorageKey: jest.fn(() => true),
        resolveAvatarUrl: jest.fn(() => null),
        processAvatar: jest.fn(),
        generatePresignedUploadUrl: jest.fn(),
      })
      .compile();

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
      .post(`${BASE}/auth/login`)
      .send({ email: 'admin@dentalab.com', password: 'Admin@123' });
    adminToken = adminLogin.body.data?.accessToken ?? '';
    if (!adminToken) {
      console.error(
        'Admin login failed:',
        JSON.stringify(adminLogin.body).substring(0, 200),
      );
    }

    const rolesRes = await request(app.getHttpServer())
      .get(`${BASE}/rbac/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 50 });
    const roles: any[] = rolesRes.body.data ?? [];
    managerRoleId = roles.find((r: any) => r.code === 'MANAGER')?.id ?? '';
    doctorRoleId = roles.find((r: any) => r.code === 'DOCTOR')?.id ?? '';

    const permsRes = await request(app.getHttpServer())
      .get(`${BASE}/rbac/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 200 });
    const perms: any[] = permsRes.body.data ?? [];
    hrPermissionId =
      perms.find(
        (p: any) =>
          p.resource === 'documents' &&
          p.action === 'access' &&
          p.scope === 'hr',
      )?.id ?? '';

    const managerRes = await request(app.getHttpServer())
      .post(`${BASE}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: E2E_MANAGER.email,
        fullName: E2E_MANAGER.fullName,
        password: E2E_MANAGER.password,
        roleIds: managerRoleId ? [managerRoleId] : [],
      });
    managerId = managerRes.body.data?.id ?? '';

    const doctorRes = await request(app.getHttpServer())
      .post(`${BASE}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: E2E_DOCTOR.email,
        fullName: E2E_DOCTOR.fullName,
        password: E2E_DOCTOR.password,
        roleIds: doctorRoleId ? [doctorRoleId] : [],
      });
    doctorId = doctorRes.body.data?.id ?? '';

    const managerLogin = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: E2E_MANAGER.email, password: E2E_MANAGER.password });
    managerToken = managerLogin.body.data?.accessToken ?? '';

    const doctorLogin = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: E2E_DOCTOR.email, password: E2E_DOCTOR.password });
    doctorToken = doctorLogin.body.data?.accessToken ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('fixture sanity', () => {
    it('0. all tokens and IDs resolved', () => {
      expect(adminToken).toBeTruthy();
      expect(managerToken).toBeTruthy();
      expect(doctorToken).toBeTruthy();
      if (!managerId) console.error('managerId empty');
      if (!doctorId) console.error('doctorId empty');
      if (!managerRoleId) console.error('managerRoleId empty');
      if (!doctorRoleId) console.error('doctorRoleId empty');
      if (!hrPermissionId)
        console.error(
          'hrPermissionId empty — seed may be missing documents:access:hr',
        );
    });
  });

  describe('Document Category CRUD', () => {
    it('1. admin creates category → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/document-categories`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `E2E Cat ${TIMESTAMP}`,
          description: 'E2E test category',
        })
        .expect(201);

      catId = res.body.data?.id ?? '';
      expect(catId).toBeTruthy();
      expect(res.body.data.name).toContain('E2E Cat');
    });

    it('2. duplicate name → 409', async () => {
      if (!catId) return;
      const catName = `E2E Cat ${TIMESTAMP}`;
      await request(app.getHttpServer())
        .post(`${BASE}/document-categories`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: catName })
        .expect(409);
    });

    it('3. doctor cannot create category → 403', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/document-categories`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ name: `Doctor Cat ${TIMESTAMP}` })
        .expect(403);
    });

    it('4. list categories → 200, contains created category', async () => {
      if (!catId) return;
      const res = await request(app.getHttpServer())
        .get(`${BASE}/document-categories`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const ids = (res.body.data ?? []).map((c: any) => c.id);
      expect(ids).toContain(catId);
    });

    it('5. get category by id → 200', async () => {
      if (!catId) return;
      const res = await request(app.getHttpServer())
        .get(`${BASE}/document-categories/${catId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(catId);
    });

    it('6. update category name → 200', async () => {
      if (!catId) return;
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/document-categories/${catId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `E2E Cat Updated ${TIMESTAMP}` })
        .expect(200);

      expect(res.body.data.name).toContain('Updated');
    });
  });

  describe('Document CRUD', () => {
    it('7. admin creates published doc → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: `E2E Doc ${TIMESTAMP}`,
          isPublished: true,
          categoryId: catId || undefined,
        })
        .expect(201);

      docId = res.body.data?.id ?? '';
      expect(docId).toBeTruthy();
      expect(res.body.data.activeVersionId).toBeNull();
    });

    it('8. admin creates unpublished doc → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: `E2E Doc B ${TIMESTAMP}`, isPublished: false })
        .expect(201);

      docBId = res.body.data?.id ?? '';
      expect(docBId).toBeTruthy();
    });

    it('9. doctor cannot create document → 403', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/documents`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ title: 'Unauthorized Doc' })
        .expect(403);
    });

    it('10. manager sees both published and unpublished in list', async () => {
      if (!docId || !docBId) return;
      const res = await request(app.getHttpServer())
        .get(`${BASE}/documents`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      const ids = (res.body.data ?? []).map((d: any) => d.id);
      expect(ids).toContain(docId);
      expect(ids).toContain(docBId);
    });

    it('11. doctor sees only published docs in list', async () => {
      if (!docId || !docBId) return;
      const res = await request(app.getHttpServer())
        .get(`${BASE}/documents`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      const ids = (res.body.data ?? []).map((d: any) => d.id);
      expect(ids).toContain(docId);
      expect(ids).not.toContain(docBId);
    });

    it('12. get doc by id → 200', async () => {
      if (!docId) return;
      const res = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(docId);
    });

    it('13. doctor cannot PATCH document → 403', async () => {
      if (!docId) return;
      await request(app.getHttpServer())
        .patch(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ title: 'Hacked' })
        .expect(403);
    });

    it('14. doctor cannot DELETE document → 403', async () => {
      if (!docId) return;
      await request(app.getHttpServer())
        .delete(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(403);
    });

    it('15. admin updates doc metadata → 200', async () => {
      if (!docId) return;
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: `E2E Doc Updated ${TIMESTAMP}` })
        .expect(200);

      expect(res.body.data.title).toContain('Updated');
    });

    it('16. get non-existent doc → 404', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/documents/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Document Versions', () => {
    it('17. upload valid PDF → 201, version 1 becomes active', async () => {
      if (!docId) return;
      const res = await request(app.getHttpServer())
        .post(`${BASE}/documents/${docId}/versions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', PDF_MAGIC, {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      ver1Id = res.body.data?.id ?? '';
      expect(ver1Id).toBeTruthy();
      expect(res.body.data.versionNumber).toBe(1);

      const docRes = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(docRes.body.data.activeVersionId).toBe(ver1Id);
    });

    it('18. upload second PDF → 201, version 2 becomes active', async () => {
      if (!docId) return;
      const res = await request(app.getHttpServer())
        .post(`${BASE}/documents/${docId}/versions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', PDF_MAGIC, {
          filename: 'test-v2.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      ver2Id = res.body.data?.id ?? '';
      expect(ver2Id).toBeTruthy();
      expect(res.body.data.versionNumber).toBe(2);

      const docRes = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(docRes.body.data.activeVersionId).toBe(ver2Id);
    });

    it('19. list versions → 200, returns 2 versions descending', async () => {
      if (!docId) return;
      const res = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}/versions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const versions: Array<{ versionNumber: number }> = res.body.data ?? [];
      expect(versions.length).toBeGreaterThanOrEqual(2);
      expect(versions[0].versionNumber).toBeGreaterThan(
        versions[1].versionNumber,
      );
    });

    it('20. activate version 1 again → activeVersionId updated', async () => {
      if (!docId || !ver1Id) return;
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/documents/${docId}/active-version`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ versionId: ver1Id })
        .expect(200);

      expect(res.body.data.activeVersionId).toBe(ver1Id);
    });

    it('21. activate non-existent version → 404', async () => {
      if (!docId) return;
      const nonExistentVersionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      await request(app.getHttpServer())
        .patch(`${BASE}/documents/${docId}/active-version`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ versionId: nonExistentVersionId })
        .expect(404);
    });

    it('22. upload .exe renamed to .pdf → 400 magic-byte fail', async () => {
      if (!docId) return;
      await request(app.getHttpServer())
        .post(`${BASE}/documents/${docId}/versions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', EXE_BYTES, {
          filename: 'malware.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
    });

    it('23. upload 30 MB file → 413 or 400 size fail', async () => {
      if (!docId) return;
      const bigBuffer = Buffer.alloc(30 * 1024 * 1024, 0x25);
      const res = await request(app.getHttpServer())
        .post(`${BASE}/documents/${docId}/versions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', bigBuffer, {
          filename: 'big.pdf',
          contentType: 'application/pdf',
        });

      expect([400, 413]).toContain(res.status);
    });

    it('24. doctor cannot upload version → 403', async () => {
      if (!docId) return;
      await request(app.getHttpServer())
        .post(`${BASE}/documents/${docId}/versions`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .attach('file', PDF_MAGIC, {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .expect(403);
    });
  });

  describe('Download URL', () => {
    it('25. get download URL for version → 200, has downloadUrl', async () => {
      if (!docId || !ver1Id) return;
      const res = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}/versions/${ver1Id}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.downloadUrl).toBeTruthy();
      expect(res.body.data.expiresIn).toBe(300);
    });

    it('26. download for missing version → 404', async () => {
      if (!docId) return;
      await request(app.getHttpServer())
        .get(
          `${BASE}/documents/${docId}/versions/00000000-0000-0000-0000-000000000002/download`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('ACL scenarios', () => {
    it('27. set ACL on docId with hrPermission → 200', async () => {
      if (!docId || !hrPermissionId) return;
      const res = await request(app.getHttpServer())
        .put(`${BASE}/documents/${docId}/access`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionIds: [hrPermissionId] })
        .expect(200);

      expect(res.body.data.added).toContain(hrPermissionId);
    });

    it('28. doctor (no hr perm) gets 404 on restricted doc detail', async () => {
      if (!docId || !hrPermissionId) return;
      await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(404);
    });

    it('29. doctor (no hr perm) gets 404 on restricted doc download', async () => {
      if (!docId || !ver1Id || !hrPermissionId) return;
      await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}/versions/${ver1Id}/download`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(404);
    });

    it('30. doctor not in restricted list can see docB (no ACL rows)', async () => {
      if (!docBId) return;

      await request(app.getHttpServer())
        .patch(`${BASE}/documents/${docBId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isPublished: true });

      const res = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docBId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(docBId);
    });

    it('31. grant doctor hr perm via override → now sees restricted doc', async () => {
      if (!docId || !hrPermissionId || !doctorId) return;

      await request(app.getHttpServer())
        .post(`${BASE}/rbac/users/${doctorId}/overrides`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionId: hrPermissionId, grantType: 'grant' });

      const res = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(docId);
    });

    it('32. PUT /access with unknown permissionId → 400', async () => {
      if (!docId) return;
      await request(app.getHttpServer())
        .put(`${BASE}/documents/${docId}/access`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionIds: ['00000000-0000-0000-0000-000000000099'] })
        .expect(400);
    });

    it('33. PUT /access with empty array → ACL cleared', async () => {
      if (!docId) return;

      if (hrPermissionId) {
        await request(app.getHttpServer())
          .put(`${BASE}/documents/${docId}/access`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ permissionIds: [hrPermissionId] });
      }

      await request(app.getHttpServer())
        .put(`${BASE}/documents/${docId}/access`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionIds: [] })
        .expect(200);

      const accessRes = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}/access`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(accessRes.body.data).toHaveLength(0);
    });

    it('34. manager bypass — manager can always see restricted doc', async () => {
      if (!docId || !hrPermissionId) return;
      await request(app.getHttpServer())
        .put(`${BASE}/documents/${docId}/access`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionIds: [hrPermissionId] });

      const res = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(docId);
    });
  });

  describe('Category soft-delete cascade', () => {
    it('35. delete category → 200, documents categoryId nullified', async () => {
      if (!catId || !docId) return;

      await request(app.getHttpServer())
        .patch(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ categoryId: catId });

      await request(app.getHttpServer())
        .delete(`${BASE}/document-categories/${catId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const docRes = await request(app.getHttpServer())
        .get(`${BASE}/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(docRes.body.data.categoryId).toBeNull();

      await request(app.getHttpServer())
        .get(`${BASE}/document-categories/${catId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Document soft-delete', () => {
    it('36. admin soft-deletes doc → 200, doc not found afterwards', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: `E2E Delete ${TIMESTAMP}`, isPublished: true })
        .expect(201);

      const deleteDocId = createRes.body.data?.id;
      expect(deleteDocId).toBeTruthy();

      await request(app.getHttpServer())
        .delete(`${BASE}/documents/${deleteDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`${BASE}/documents/${deleteDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
