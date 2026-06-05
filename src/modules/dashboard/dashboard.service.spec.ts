import { Test } from '@nestjs/testing';
import { PrismaService } from '@modules/database';
import { PermissionResolverService } from '@modules/rbac/services/permission-resolver.service';
import { DEFAULT_ROLE_PERMISSIONS } from '@modules/rbac/default-role-permissions';
import { DashboardService } from './dashboard.service';
import type { AuthenticatedUser } from '@common/interfaces';

const DOCTOR_PERMS = DEFAULT_ROLE_PERMISSIONS.DOCTOR;
const MANAGER_PERMS = DEFAULT_ROLE_PERMISSIONS.MANAGER;

function makeUser(roleCodes: string[]): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'u@x.com',
    fullName: 'Test User',
    isActive: true,
    roleCodes,
  };
}

describe('DashboardService permission gating', () => {
  let service: DashboardService;
  let prisma: any;
  let resolver: any;

  beforeEach(async () => {
    const emptyAgg = { _sum: { actualFee: null, estimatedFee: null } };
    const list = () => jest.fn().mockResolvedValue([]);
    const zero = () => jest.fn().mockResolvedValue(0);
    prisma = {
      client: {
        provider: { findUnique: jest.fn().mockResolvedValue(null) },
        appointment: { groupBy: list(), findMany: list(), count: zero() },
        clinicalNote: { count: zero(), findMany: list() },
        treatmentPlan: { groupBy: list() },
        patient: { count: zero(), findMany: list() },
        patientProcedure: {
          aggregate: jest.fn().mockResolvedValue(emptyAgg),
        },
      },
      baseClient: { $queryRaw: jest.fn().mockResolvedValue([]) },
    };
    resolver = { resolvePermissions: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolverService, useValue: resolver },
      ],
    }).compile();
    service = moduleRef.get(DashboardService);
  });

  it('empty perms → only range/scoped, no widget blocks', async () => {
    resolver.resolvePermissions.mockResolvedValue([]);
    const res = await service.getDashboard(makeUser([]), 'today');
    expect(res).toEqual({ range: 'today', scoped: false });
  });

  it('DOCTOR (real perms, has provider row) → NO revenue/pipeline/patients despite holding read:full perms', async () => {
    // Guard: DOCTOR holds patient_procedures:read:full, treatment_plans:read:full, patients:read.
    expect(DOCTOR_PERMS).toContain('patient_procedures:read:full');
    expect(DOCTOR_PERMS).toContain('patients:read');
    expect(DOCTOR_PERMS).not.toContain('financial_reports:read');

    resolver.resolvePermissions.mockResolvedValue(DOCTOR_PERMS);
    prisma.client.provider.findUnique.mockResolvedValue({ id: 'prov-1' });

    const res = await service.getDashboard(makeUser(['DOCTOR']), 'today');

    expect(res.scoped).toBe(true);
    expect(res.revenue).toBeUndefined();
    expect(res.pipeline).toBeUndefined();
    expect(res.patients).toBeUndefined();
    // Clinical blocks the doctor IS allowed to see:
    expect(res.appointments).toBeDefined();
    expect(res.clinicalNotes).toBeDefined();
    expect(res.treatmentPlans).toBeDefined();
  });

  it('DOCTOR scoped → clinical/schedule queries filtered by own providerId', async () => {
    resolver.resolvePermissions.mockResolvedValue(DOCTOR_PERMS);
    prisma.client.provider.findUnique.mockResolvedValue({ id: 'prov-1' });

    await service.getDashboard(makeUser(['DOCTOR']), 'today');

    const apptWhere = prisma.client.appointment.groupBy.mock.calls[0][0].where;
    expect(apptWhere.providerId).toBe('prov-1');
    const noteWhere = prisma.client.clinicalNote.count.mock.calls[0][0].where;
    expect(noteWhere.providerId).toBe('prov-1');
  });

  it('MANAGER (real perms) → financial + inventory blocks present', async () => {
    expect(MANAGER_PERMS).toContain('financial_reports:read');
    resolver.resolvePermissions.mockResolvedValue(MANAGER_PERMS);

    const res = await service.getDashboard(makeUser(['MANAGER']), 'month');

    expect(res.scoped).toBe(false);
    expect(res.revenue).toBeDefined();
    expect(res.pipeline).toBeDefined();
    expect(res.inventory).toBeDefined();
    expect(res.patients).toBeDefined();
  });

  it('MANAGER without financial_reports:read → revenue/pipeline absent', async () => {
    const stripped = MANAGER_PERMS.filter(
      (p) => p !== 'financial_reports:read',
    );
    resolver.resolvePermissions.mockResolvedValue(stripped);

    const res = await service.getDashboard(makeUser(['MANAGER']), 'month');

    expect(res.revenue).toBeUndefined();
    expect(res.pipeline).toBeUndefined();
  });
});
