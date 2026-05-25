import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Channel } from 'amqplib';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../src/modules/common/guards/rate-limit.guard';
import { AppConfigService } from '../src/modules/config';
import { PrismaService } from '../src/modules/database';
import { EMAIL_PROVIDER } from '../src/modules/email/email.constants';
import {
  QUEUE_EMAIL_SEND,
  QUEUE_NOTIFICATION_INVENTORY,
  RABBITMQ_CHANNEL,
} from '../src/modules/queue/queue.constants';
import { PermissionGuard } from '../src/modules/rbac/guards/permission.guard';

const BASE = '/api/v1';
const TIMESTAMP = Date.now();

const E2E_MANAGER = {
  email: `e2e-inv-manager-${TIMESTAMP}@dentalab.com`,
  password: 'Manager@123',
  fullName: 'E2E Inventory Manager',
};

const E2E_DOCTOR = {
  email: `e2e-inv-doctor-${TIMESTAMP}@dentalab.com`,
  password: 'Doctor@123',
  fullName: 'E2E Inventory Doctor',
};

describe('InventoryController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminToken: string;
  let managerToken: string;
  let doctorToken: string;
  let managerRoleId = '';
  let doctorRoleId = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Stub the email provider so e2e never hits the real Resend API.
      // Use a unique id per call so `email_logs.resend_id` UNIQUE never fires.
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({
        send: jest.fn(() => ({
          id: `stub-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        })),
        sendBatch: jest.fn((items: unknown[]) => ({
          results: items.map(() => ({
            id: `stub-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          })),
        })),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(AppConfigService);
    prisma = app.get(PrismaService);
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

    const rolesRes = await request(app.getHttpServer())
      .get(`${BASE}/rbac/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 50 });
    const roles: any[] = rolesRes.body.data ?? [];
    managerRoleId = roles.find((r: any) => r.code === 'MANAGER')?.id ?? '';
    doctorRoleId = roles.find((r: any) => r.code === 'DOCTOR')?.id ?? '';

    await request(app.getHttpServer())
      .post(`${BASE}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: E2E_MANAGER.email,
        fullName: E2E_MANAGER.fullName,
        password: E2E_MANAGER.password,
        roleIds: managerRoleId ? [managerRoleId] : [],
      });

    await request(app.getHttpServer())
      .post(`${BASE}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: E2E_DOCTOR.email,
        fullName: E2E_DOCTOR.fullName,
        password: E2E_DOCTOR.password,
        roleIds: doctorRoleId ? [doctorRoleId] : [],
      });

    const mgrLogin = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: E2E_MANAGER.email, password: E2E_MANAGER.password });
    managerToken = mgrLogin.body.data?.accessToken ?? '';

    const docLogin = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: E2E_DOCTOR.email, password: E2E_DOCTOR.password });
    doctorToken = docLogin.body.data?.accessToken ?? '';
  });

  afterAll(async () => {
    // Drain any low-stock or email events this suite produced so they do not
    // leak into the dev server's startup-time queue draining. We give the
    // post-commit publish + consumer fanout a moment to settle, purge, close
    // the app, then purge once more from a fresh connection to catch any
    // late-arriving messages emitted during shutdown.
    const purgeViaChannel = async (channel: Channel) => {
      try {
        await channel.purgeQueue(QUEUE_NOTIFICATION_INVENTORY);
      } catch {
        /* ignored */
      }
      try {
        await channel.purgeQueue(QUEUE_EMAIL_SEND);
      } catch {
        /* ignored */
      }
    };

    try {
      await new Promise((r) => setTimeout(r, 500));
      const channel = app.get<Channel | null>(RABBITMQ_CHANNEL);
      if (channel) await purgeViaChannel(channel);
    } catch {
      /* best-effort */
    }
    await app.close();

    try {
      const amqp = await import('amqplib');
      const url = process.env.RABBITMQ_URL ?? 'amqp://localhost:5680';
      const conn = await amqp.connect(url);
      const channel = await conn.createChannel();
      await purgeViaChannel(channel);
      await channel.close();
      await conn.close();
    } catch {
      /* best-effort */
    }
  });

  describe('CRUD', () => {
    let itemId = '';
    const sku = `E2E-SKU-${TIMESTAMP}`;

    it('Manager creates an inventory item', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Glove (box)',
          sku,
          category: 'consumables',
          unit: 'box',
          minQuantity: 5,
          costPerUnit: 12.5,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.sku).toBe(sku);
      itemId = res.body.data.id;
    });

    it('Duplicate SKU → 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Glove dup', sku, minQuantity: 1 });
      expect(res.status).toBe(409);
    });

    it('Manager updates the item', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/inventory/items/${itemId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Glove (box) — updated', minQuantity: 8 });
      expect(res.status).toBe(200);
      expect(res.body.data.minQuantity).toBe(8);
    });

    it('Manager archives the item', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${BASE}/inventory/items/${itemId}`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
    });

    it('Manager restores the item', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/restore`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(201);
      expect(res.body.data.isActive).toBe(true);
    });

    it('Doctor cannot create an item (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ name: 'Forbidden', sku: `DOC-${TIMESTAMP}`, minQuantity: 0 });
      expect(res.status).toBe(403);
    });
  });

  describe('Transactions', () => {
    let itemId = '';
    const sku = `E2E-TX-${TIMESTAMP}`;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Test item', sku, minQuantity: 5 });
      itemId = res.body.data.id;
    });

    it('Purchase +10 increases quantity', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/transactions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'purchase', quantity: 10 });
      expect(res.status).toBe(201);
      expect(res.body.data.quantityAfter).toBe(10);
    });

    it('Usage -3 decreases quantity', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/transactions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'usage', quantity: 3 });
      expect(res.status).toBe(201);
      expect(res.body.data.quantityAfter).toBe(7);
    });

    it('Usage -100 → 409 INSUFFICIENT_STOCK with currentQuantity', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/transactions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'usage', quantity: 100 });
      expect(res.status).toBe(409);
      const details = res.body.details ?? res.body.message;
      expect(JSON.stringify(details)).toContain('INSUFFICIENT_STOCK');
    });

    it('Adjustment +2 (increase)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/transactions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'adjustment', subType: 'increase', quantity: 2 });
      expect(res.status).toBe(201);
      expect(res.body.data.quantityAfter).toBe(9);
    });

    it('Adjustment -1 (decrease)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/transactions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'adjustment', subType: 'decrease', quantity: 1 });
      expect(res.status).toBe(201);
      expect(res.body.data.quantityAfter).toBe(8);
    });

    it('Adjustment WITHOUT subType → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/transactions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'adjustment', quantity: 2 });
      expect(res.status).toBe(400);
    });

    it('Purchase WITH subType → 400 (forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/transactions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'purchase', subType: 'increase', quantity: 1 });
      expect(res.status).toBe(400);
    });
  });

  describe('Concurrency', () => {
    let itemId = '';
    const sku = `E2E-CONC-${TIMESTAMP}`;

    beforeAll(async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/inventory/items`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Concurrency item', sku, minQuantity: 0 });
      itemId = create.body.data.id;

      // Seed quantity to 20 via purchase
      await request(app.getHttpServer())
        .post(`${BASE}/inventory/items/${itemId}/transactions`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'purchase', quantity: 20 });
    });

    it('50 concurrent usage -1 → 20 succeed, 30 conflict, final qty=0', async () => {
      // Bind the app to a real ephemeral port so supertest dispatches over
      // a persistent listening socket (avoids TCP backlog flake when 50
      // requests fire simultaneously against `getHttpServer()`).
      await app.listen(0);
      const server = app.getHttpServer();
      try {
        const requests = Array.from({ length: 50 }, () =>
          request(server)
            .post(`${BASE}/inventory/items/${itemId}/transactions`)
            .set('Authorization', `Bearer ${managerToken}`)
            .send({ type: 'usage', quantity: 1 }),
        );
        const results = await Promise.allSettled(requests);

        const statusCounts: Record<string, number> = {};
        for (const r of results) {
          const key =
            r.status === 'fulfilled' ? String(r.value.status) : 'rejected';
          statusCounts[key] = (statusCounts[key] ?? 0) + 1;
        }
        const successes = statusCounts['201'] ?? 0;
        const conflicts = statusCounts['409'] ?? 0;

        console.log('Concurrency status distribution:', statusCounts);

        expect(successes).toBe(20);
        expect(conflicts).toBe(30);

        const final = await prisma.baseClient.inventoryItem.findUnique({
          where: { id: itemId },
        });
        expect(final?.quantity).toBe(0);

        const txnCount = await prisma.baseClient.inventoryTransaction.count({
          where: { itemId, type: 'usage' },
        });
        expect(txnCount).toBe(20);
      } finally {
        // Releases the listening socket so `app.close()` in afterAll can run.
      }
    }, 30_000);
  });
});
