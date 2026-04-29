import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

// ── Default Roles ──
// `code` is the stable machine identifier (upper-snake-case, immutable).
// `name` is the display label (Vietnamese, editable for non-system roles).
const DEFAULT_ROLES = [
  {
    code: 'ADMIN',
    name: 'Quản trị viên',
    description: 'Quản trị viên toàn hệ thống',
    isSystem: true,
  },
  {
    code: 'DOCTOR',
    name: 'Bác sĩ',
    description: 'Bác sĩ / nhân viên y tế',
    isSystem: true,
  },
  {
    code: 'RECEPTIONIST',
    name: 'Lễ tân',
    description: 'Nhân viên lễ tân',
    isSystem: true,
  },
  {
    code: 'MANAGER',
    name: 'Quản lý',
    description: 'Quản lý vận hành',
    isSystem: true,
  },
];

// ── All Permissions ──
const PERMISSIONS: {
  resource: string;
  action: string;
  scope?: string;
  description?: string;
}[] = [
  // Auth & RBAC
  { resource: 'roles', action: 'create' },
  { resource: 'roles', action: 'read' },
  { resource: 'roles', action: 'update' },
  { resource: 'roles', action: 'delete' },
  { resource: 'permissions', action: 'create' },
  { resource: 'permissions', action: 'read' },
  { resource: 'permissions', action: 'update' },
  { resource: 'permissions', action: 'delete' },
  { resource: 'users', action: 'create' },
  {
    resource: 'users',
    action: 'read',
    scope: 'all',
    description: 'Xem tất cả người dùng, bao gồm cả Quản trị viên',
  },
  {
    resource: 'users',
    action: 'read',
    scope: 'non_admin',
    description: 'Xem người dùng nhưng không thấy Quản trị viên',
  },
  { resource: 'users', action: 'update' },
  { resource: 'users', action: 'delete' },
  { resource: 'audit_logs', action: 'read' },
  {
    resource: 'audit_logs',
    action: 'read',
    scope: 'all',
    description: 'Xem toàn bộ nhật ký kiểm tra',
  },
  {
    resource: 'audit_logs',
    action: 'read',
    scope: 'operations',
    description: 'Xem nhật ký kiểm tra tài nguyên & vận hành',
  },
  {
    resource: 'audit_logs',
    action: 'read',
    scope: 'phi',
    description: 'Xem sự kiện PHI trong nhật ký kiểm tra',
  },

  // Providers
  { resource: 'providers', action: 'create' },
  { resource: 'providers', action: 'read' },
  { resource: 'providers', action: 'update' },
  { resource: 'providers', action: 'delete' },

  // Appointments & Procedures
  { resource: 'appointments', action: 'create' },
  { resource: 'appointments', action: 'read' },
  { resource: 'appointments', action: 'update' },
  { resource: 'appointments', action: 'delete' },
  { resource: 'procedures', action: 'create' },
  { resource: 'procedures', action: 'read' },
  { resource: 'procedures', action: 'update' },
  { resource: 'procedures', action: 'delete' },
  { resource: 'appointment_types', action: 'create' },
  { resource: 'appointment_types', action: 'read' },
  { resource: 'appointment_types', action: 'update' },
  { resource: 'appointment_types', action: 'delete' },
  { resource: 'treatment_plans', action: 'create' },
  { resource: 'treatment_plans', action: 'read' },
  { resource: 'treatment_plans', action: 'update' },
  { resource: 'treatment_plans', action: 'delete' },
  { resource: 'provider_schedules', action: 'create' },
  { resource: 'provider_schedules', action: 'read' },
  { resource: 'provider_schedules', action: 'update' },
  { resource: 'provider_schedules', action: 'delete' },
  { resource: 'schedule_overrides', action: 'create' },
  { resource: 'schedule_overrides', action: 'read' },
  { resource: 'schedule_overrides', action: 'update' },

  // Patients
  { resource: 'patients', action: 'create' },
  { resource: 'patients', action: 'read' },
  { resource: 'patients', action: 'update' },
  { resource: 'patients', action: 'delete' },
  { resource: 'clinical_notes', action: 'create' },
  { resource: 'clinical_notes', action: 'read' },
  { resource: 'clinical_notes', action: 'update' },
  { resource: 'patient_files', action: 'create' },
  { resource: 'patient_files', action: 'read' },
  { resource: 'patient_files', action: 'delete' },
  // Resources & Operations
  { resource: 'forms', action: 'create' },
  { resource: 'forms', action: 'read' },
  { resource: 'forms', action: 'update' },
  { resource: 'forms', action: 'delete' },
  { resource: 'form_submissions', action: 'read' },
  { resource: 'kiosk_sessions', action: 'create' },
  { resource: 'kiosk_sessions', action: 'read' },
  { resource: 'internal_documents', action: 'create' },
  { resource: 'internal_documents', action: 'read' },
  { resource: 'internal_documents', action: 'update' },
  { resource: 'internal_documents', action: 'delete' },
  { resource: 'inventory_items', action: 'create' },
  { resource: 'inventory_items', action: 'read' },
  { resource: 'inventory_items', action: 'update' },
  { resource: 'inventory_items', action: 'delete' },
  { resource: 'email_logs', action: 'read' },
  {
    resource: 'email_logs',
    action: 'manage',
    description: 'Gửi lại email thất bại, xem thống kê',
  },

  // AI Chatbot
  { resource: 'chat_sessions', action: 'create' },
  { resource: 'chat_sessions', action: 'read' },
  { resource: 'chat_sessions', action: 'delete' },
  { resource: 'rag_patient_notes', action: 'read' },
  { resource: 'rag_internal_docs', action: 'read' },

  // Scoped: Admin user management
  {
    resource: 'users',
    action: 'create',
    scope: 'admin',
    description: 'Tạo người dùng với vai trò Quản trị viên',
  },
  {
    resource: 'users',
    action: 'update',
    scope: 'admin',
    description: 'Gán/gỡ vai trò Quản trị viên cho người dùng',
  },
];

// ── Role-Permission Mappings ──
// Shared with the `resetRolePermissions` endpoint via
// `src/modules/rbac/default-role-permissions.ts`. Admin is computed
// dynamically as "all currently-defined permissions".
import {
  DEFAULT_ROLE_PERMISSIONS,
  perm,
  scopedPerm,
} from '../src/modules/rbac/default-role-permissions';

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: PERMISSIONS.map((p) =>
    p.scope
      ? scopedPerm(p.resource, p.action, p.scope)
      : perm(p.resource, p.action),
  ),
  ...DEFAULT_ROLE_PERMISSIONS,
};

async function main() {
  console.log('Seeding database...');

  // 1. Seed roles (keyed by immutable `code`)
  console.log('  → Seeding roles...');
  const roles: Record<string, string> = {};
  for (const role of DEFAULT_ROLES) {
    const created = await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
    roles[created.code!] = created.id;
  }
  console.log(`    ✓ ${Object.keys(roles).length} roles`);

  // 2. Seed permissions (batch create + single fetch)
  console.log('  → Seeding permissions...');
  await prisma.permission.createMany({
    data: PERMISSIONS,
    skipDuplicates: true,
  });
  const allPermissions = await prisma.permission.findMany();
  const permMap: Record<string, string> = {};
  for (const p of allPermissions) {
    const key = p.scope
      ? `${p.resource}:${p.action}:${p.scope}`
      : `${p.resource}:${p.action}`;
    permMap[key] = p.id;
  }
  console.log(`    ✓ ${allPermissions.length} permissions`);

  // 3. Seed role-permission mappings
  console.log('  → Seeding role-permission mappings...');
  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roles[roleName];
    if (!roleId) continue;

    const data = perms
      .filter((p) => permMap[p]) // Only map permissions that exist
      .map((p) => ({
        roleId: roleId,
        permissionId: permMap[p],
      }));

    await prisma.rolePermission.createMany({
      data,
      skipDuplicates: true,
    });
    console.log(`    ✓ ${roleName}: ${data.length} permissions`);
  }

  // 4. Seed default admin user
  console.log('  → Seeding admin user...');
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@dentalab.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@123';
  const BCRYPT_ROUNDS = 10;
  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: passwordHash,
      fullName: 'Quản trị viên hệ thống',
      isActive: true,
    },
  });

  // Assign Admin role
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: roles['ADMIN'],
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: roles['ADMIN'],
    },
  });
  console.log(`    ✓ Admin user: ${adminEmail}`);

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
