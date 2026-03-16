import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';
import { readFileSync } from 'fs';
import mjml from 'mjml';
import { join } from 'path';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

// ── Default Roles ──
const DEFAULT_ROLES = [
  { name: 'Admin', description: 'Full system administrator', is_system: true },
  {
    name: 'Doctor',
    description: 'Dentist / healthcare provider',
    is_system: true,
  },
  { name: 'Receptionist', description: 'Front desk staff', is_system: true },
  { name: 'Manager', description: 'Operations manager', is_system: true },
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
  { resource: 'users', action: 'read' },
  { resource: 'users', action: 'update' },
  { resource: 'users', action: 'delete' },
  { resource: 'audit_logs', action: 'read' },

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
  { resource: 'patient_insurances', action: 'create' },
  { resource: 'patient_insurances', action: 'read' },
  { resource: 'patient_insurances', action: 'update' },
  { resource: 'patient_insurances', action: 'delete' },

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
  { resource: 'email_templates', action: 'create' },
  { resource: 'email_templates', action: 'read' },
  { resource: 'email_templates', action: 'update' },
  { resource: 'email_templates', action: 'delete' },
  { resource: 'email_logs', action: 'read' },
  {
    resource: 'email_logs',
    action: 'manage',
    description: 'Resend failed emails, view stats',
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
    description: 'Create users with Admin role',
  },
  {
    resource: 'users',
    action: 'update',
    scope: 'admin',
    description: 'Assign/remove Admin role on users',
  },
];

// ── Role-Permission Mappings (based on actor-module matrix) ──

function perm(resource: string, action: string): string {
  return `${resource}:${action}`;
}

function scopedPerm(resource: string, action: string, scope: string): string {
  return `${resource}:${action}:${scope}`;
}

function allActions(resource: string): string[] {
  return ['create', 'read', 'update', 'delete'].map((a) => perm(resource, a));
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  Admin: PERMISSIONS.map((p) =>
    p.scope
      ? scopedPerm(p.resource, p.action, p.scope)
      : perm(p.resource, p.action),
  ), // ALL permissions

  Doctor: [
    perm('appointments', 'read'),
    perm('appointments', 'update'),
    perm('procedures', 'read'),
    perm('appointment_types', 'read'),
    perm('patients', 'read'),
    ...allActions('clinical_notes'),
    perm('patient_files', 'create'),
    perm('patient_files', 'read'),
    ...allActions('treatment_plans'),
    perm('schedule_overrides', 'create'),
    perm('schedule_overrides', 'read'),
    perm('provider_schedules', 'read'),
    perm('internal_documents', 'read'),
    perm('forms', 'read'),
    perm('form_submissions', 'read'),
    perm('chat_sessions', 'create'),
    perm('chat_sessions', 'read'),
    perm('chat_sessions', 'delete'),
    perm('rag_patient_notes', 'read'),
    perm('rag_internal_docs', 'read'),
  ],

  Receptionist: [
    ...allActions('appointments'),
    ...allActions('patients'),
    ...allActions('patient_insurances'),
    perm('patient_files', 'create'),
    perm('patient_files', 'read'),
    perm('procedures', 'read'),
    perm('appointment_types', 'read'),
    perm('provider_schedules', 'read'),
    perm('forms', 'read'),
    perm('form_submissions', 'read'),
    perm('kiosk_sessions', 'create'),
    perm('kiosk_sessions', 'read'),
    perm('internal_documents', 'read'),
    perm('chat_sessions', 'create'),
    perm('chat_sessions', 'read'),
    perm('chat_sessions', 'delete'),
    perm('rag_internal_docs', 'read'),
  ],

  Manager: [
    perm('appointments', 'read'),
    perm('patients', 'read'),
    ...allActions('internal_documents'),
    ...allActions('inventory_items'),
    ...allActions('email_templates'),
    ...allActions('forms'),
    perm('form_submissions', 'read'),
    perm('schedule_overrides', 'read'),
    perm('schedule_overrides', 'update'),
    perm('provider_schedules', 'read'),
    perm('provider_schedules', 'update'),
    perm('chat_sessions', 'create'),
    perm('chat_sessions', 'read'),
    perm('chat_sessions', 'delete'),
    perm('rag_internal_docs', 'read'),
    perm('email_logs', 'read'),
  ],
};

async function main() {
  console.log('Seeding database...');

  // 1. Seed roles
  console.log('  → Seeding roles...');
  const roles: Record<string, string> = {};
  for (const role of DEFAULT_ROLES) {
    const created = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
    roles[created.name] = created.id;
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
        role_id: roleId,
        permission_id: permMap[p],
      }));

    await prisma.rolePermission.createMany({
      data,
      skipDuplicates: true,
    });
    console.log(`    ✓ ${roleName}: ${data.length} permissions`);
  }

  // 4. Seed system email templates
  console.log('  → Seeding email templates...');
  const baseLayout = readFileSync(
    join(__dirname, 'email-templates/layouts/base.mjml'),
    'utf-8',
  );
  const templateDefs: {
    name: string;
    subject: string;
    type: string;
    file: string;
    variables: { required: string[]; optional: string[] };
  }[] = JSON.parse(
    readFileSync(join(__dirname, 'email-templates/templates.json'), 'utf-8'),
  );

  for (const def of templateDefs) {
    const childMjml = readFileSync(
      join(__dirname, `email-templates/${def.file}`),
      'utf-8',
    );
    const fullMjml = baseLayout.replace('{{{content}}}', childMjml);
    const { html } = mjml(fullMjml, { validationLevel: 'soft' });

    await prisma.emailTemplate.upsert({
      where: { name: def.name },
      update: {
        subject: def.subject,
        body_mjml: fullMjml,
        body_html: html,
        type: def.type,
        variables: def.variables,
        is_system: true,
      },
      create: {
        name: def.name,
        subject: def.subject,
        body_mjml: fullMjml,
        body_html: html,
        type: def.type,
        variables: def.variables,
        is_system: true,
        is_active: true,
      },
    });
    console.log(`    ✓ Template: ${def.name}`);
  }

  // 5. Seed default admin user
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
      password_hash: passwordHash,
      full_name: 'System Admin',
      is_active: true,
    },
  });

  // Assign Admin role
  await prisma.userRole.upsert({
    where: {
      user_id_role_id: {
        user_id: adminUser.id,
        role_id: roles['Admin'],
      },
    },
    update: {},
    create: {
      user_id: adminUser.id,
      role_id: roles['Admin'],
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
