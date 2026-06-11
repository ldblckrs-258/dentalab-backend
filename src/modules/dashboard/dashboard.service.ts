import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/database';
import { PermissionResolverService } from '@modules/rbac/services/permission-resolver.service';
import { DEFAULT_TIMEZONE } from '@common/constants/app.constants';
import type { AuthenticatedUser } from '@common/interfaces';
import type { DashboardRange } from './dto/dashboard-query.dto';
import type {
  DashboardResponse,
  KpiValue,
  RevenuePoint,
} from './dashboard.types';

dayjs.extend(utc);
dayjs.extend(timezone);

interface DateWindow {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
}

const ACTIVE_PLAN_STATUSES = ['draft', 'proposed', 'accepted', 'in_progress'];
const SCHEDULE_HIDDEN_STATUSES = ['cancelled', 'no_show'];
const REVENUE_TREND_DAYS = 30;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async getDashboard(
    user: AuthenticatedUser,
    range: DashboardRange = 'today',
  ): Promise<DashboardResponse> {
    const perms = await this.permissionResolver.resolvePermissions(user.id);
    const has = (p: string) => perms.includes(p);
    const window = this.dateWindow(range);
    const day = this.dayWindow();

    const providerRow = await this.prisma.client.provider.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    // Any user backed by a Provider record sees a provider-scoped dashboard:
    // every count + list is filtered to their own providerId.
    const scoped = !!providerRow;
    const providerId = scoped ? providerRow.id : null;

    const result: DashboardResponse = { range, scoped };

    const tasks: Array<Promise<void>> = [];
    const run = (cond: boolean, label: string, fn: () => Promise<void>) => {
      if (!cond) return;
      tasks.push(
        fn().catch((err) => {
          this.logger.warn(`Dashboard block "${label}" failed: ${err}`);
        }),
      );
    };

    run(has('appointments:read'), 'appointments', async () => {
      result.appointments = await this.buildAppointments(day, providerId);
    });
    run(has('clinical_notes:read'), 'clinicalNotes', async () => {
      result.clinicalNotes = await this.buildClinicalNotes(providerId);
    });
    run(has('treatment_plans:read'), 'treatmentPlans', async () => {
      result.treatmentPlans = await this.buildTreatmentPlans(providerId);
    });
    run(has('patients:read') && !scoped, 'patients', async () => {
      result.patients = await this.buildPatients(window);
    });
    run(has('financial_reports:read'), 'revenue', async () => {
      result.revenue = await this.buildRevenue(window);
    });
    run(has('financial_reports:read'), 'pipeline', async () => {
      result.pipeline = await this.buildPipeline();
    });
    run(has('inventory_items:read'), 'inventory', async () => {
      result.inventory = await this.buildInventory();
    });

    await Promise.allSettled(tasks);
    return result;
  }

  // ── Date windows (clinic timezone) ──────────────────────────────

  private dayWindow(): { start: Date; end: Date } {
    const now = dayjs().tz(DEFAULT_TIMEZONE);
    return {
      start: now.startOf('day').toDate(),
      end: now.endOf('day').toDate(),
    };
  }

  private dateWindow(range: DashboardRange): DateWindow {
    const now = dayjs().tz(DEFAULT_TIMEZONE);
    if (range === 'week') {
      const start = now.subtract(6, 'day').startOf('day');
      return {
        start: start.toDate(),
        end: now.endOf('day').toDate(),
        prevStart: start.subtract(7, 'day').toDate(),
        prevEnd: start.subtract(1, 'millisecond').toDate(),
      };
    }
    if (range === 'month') {
      const start = now.startOf('month');
      return {
        start: start.toDate(),
        end: now.endOf('day').toDate(),
        prevStart: start.subtract(1, 'month').toDate(),
        prevEnd: start.subtract(1, 'millisecond').toDate(),
      };
    }
    const start = now.startOf('day');
    return {
      start: start.toDate(),
      end: now.endOf('day').toDate(),
      prevStart: start.subtract(1, 'day').toDate(),
      prevEnd: start.subtract(1, 'millisecond').toDate(),
    };
  }

  private kpi(current: number, prev: number): KpiValue {
    if (!prev) return { value: current };
    return { value: current, deltaPct: ((current - prev) / prev) * 100 };
  }

  // ── Block builders ──────────────────────────────────────────────

  private async buildAppointments(
    day: { start: Date; end: Date },
    providerId: string | null,
  ) {
    const providerWhere = providerId ? { providerId } : {};
    const where: Prisma.AppointmentWhereInput = {
      startTime: { gte: day.start, lte: day.end },
      ...providerWhere,
    };
    const [grouped, schedule, futureCount] = await Promise.all([
      this.prisma.client.appointment.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.client.appointment.findMany({
        where: { ...where, status: { notIn: SCHEDULE_HIDDEN_STATUSES } },
        orderBy: { startTime: 'asc' },
        take: 20,
        select: {
          id: true,
          startTime: true,
          endTime: true,
          status: true,
          patient: { select: { firstName: true, lastName: true } },
          provider: { select: { user: { select: { fullName: true } } } },
          appointmentType: { select: { name: true } },
        },
      }),
      this.prisma.client.appointment.count({
        where: {
          startTime: { gt: day.end },
          status: { notIn: SCHEDULE_HIDDEN_STATUSES },
          ...providerWhere,
        },
      }),
    ]);

    const today: Record<string, number> = {};
    for (const g of grouped) today[g.status] = g._count._all;
    const todayCount = grouped
      .filter((g) => !SCHEDULE_HIDDEN_STATUSES.includes(g.status))
      .reduce((sum, g) => sum + g._count._all, 0);

    return {
      today,
      todayCount,
      futureCount,
      schedule: schedule.map((a) => ({
        id: a.id,
        startTime: a.startTime.toISOString(),
        endTime: a.endTime.toISOString(),
        patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
        providerName: a.provider.user?.fullName ?? '',
        typeName: a.appointmentType.name,
        status: a.status,
      })),
    };
  }

  private async buildClinicalNotes(providerId: string | null) {
    const where: Prisma.ClinicalNoteWhereInput = {
      status: 'draft',
      ...(providerId && { providerId }),
    };
    const [pendingCount, pending] = await Promise.all([
      this.prisma.client.clinicalNote.count({ where }),
      this.prisma.client.clinicalNote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          patient: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    return {
      pendingCount,
      pending: pending.map((n) => ({
        id: n.id,
        patientName: `${n.patient.firstName} ${n.patient.lastName}`.trim(),
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  private async buildTreatmentPlans(providerId: string | null) {
    const grouped = await this.prisma.client.treatmentPlan.groupBy({
      by: ['status'],
      where: { ...(providerId && { providerId }) },
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;
    const activeCount = ACTIVE_PLAN_STATUSES.reduce(
      (sum, status) => sum + (byStatus[status] ?? 0),
      0,
    );
    return { activeCount, byStatus };
  }

  private async buildPatients(window: DateWindow) {
    const [newInRange, prevNew, activeTotal, recent] = await Promise.all([
      this.prisma.client.patient.count({
        where: { createdAt: { gte: window.start, lte: window.end } },
      }),
      this.prisma.client.patient.count({
        where: { createdAt: { gte: window.prevStart, lte: window.prevEnd } },
      }),
      this.prisma.client.patient.count(),
      this.prisma.client.patient.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, firstName: true, lastName: true, createdAt: true },
      }),
    ]);
    return {
      newInRange: this.kpi(newInRange, prevNew),
      activeTotal,
      recent: recent.map((p) => ({
        id: p.id,
        fullName: `${p.firstName} ${p.lastName}`.trim(),
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  private async buildRevenue(window: DateWindow) {
    const [inRange, prev, trend] = await Promise.all([
      this.prisma.client.patientProcedure.aggregate({
        _sum: { actualFee: true },
        where: {
          status: 'completed',
          completedAt: { gte: window.start, lte: window.end },
          deletedAt: null,
        },
      }),
      this.prisma.client.patientProcedure.aggregate({
        _sum: { actualFee: true },
        where: {
          status: 'completed',
          completedAt: { gte: window.prevStart, lte: window.prevEnd },
          deletedAt: null,
        },
      }),
      this.revenueTrend(),
    ]);
    return {
      inRange: this.kpi(
        Number(inRange._sum.actualFee ?? 0),
        Number(prev._sum.actualFee ?? 0),
      ),
      trend,
    };
  }

  private async revenueTrend(): Promise<RevenuePoint[]> {
    const trendStart = dayjs()
      .tz(DEFAULT_TIMEZONE)
      .subtract(REVENUE_TREND_DAYS - 1, 'day')
      .startOf('day')
      .toDate();
    const rows = await this.prisma.baseClient.$queryRaw<
      Array<{ day: string; total: Prisma.Decimal | null }>
    >`
      SELECT to_char(((completed_at AT TIME ZONE 'UTC') AT TIME ZONE ${DEFAULT_TIMEZONE})::date, 'YYYY-MM-DD') AS day,
             SUM(actual_fee) AS total
      FROM patient_procedures
      WHERE completed_at >= ${trendStart}
        AND status = 'completed'
        AND deleted_at IS NULL
      GROUP BY day
      ORDER BY day
    `;
    const byDay = new Map<string, number>();
    for (const r of rows) {
      byDay.set(r.day, Number(r.total ?? 0));
    }
    const out: RevenuePoint[] = [];
    for (let i = REVENUE_TREND_DAYS - 1; i >= 0; i--) {
      const d = dayjs()
        .tz(DEFAULT_TIMEZONE)
        .subtract(i, 'day')
        .format('YYYY-MM-DD');
      out.push({ date: d, total: byDay.get(d) ?? 0 });
    }
    return out;
  }

  private async buildPipeline() {
    const [completed, live] = await Promise.all([
      this.prisma.client.patientProcedure.aggregate({
        _sum: { actualFee: true },
        where: {
          status: 'completed',
          treatmentPlanId: { not: null },
          deletedAt: null,
        },
      }),
      this.prisma.client.patientProcedure.aggregate({
        _sum: { estimatedFee: true },
        where: {
          status: { in: ['planned', 'scheduled', 'in_progress'] },
          treatmentPlanId: { not: null },
          deletedAt: null,
        },
      }),
    ]);
    return {
      estimatedPlanned:
        Number(completed._sum.actualFee ?? 0) +
        Number(live._sum.estimatedFee ?? 0),
    };
  }

  private async buildInventory() {
    const [lowStock, countRows] = await Promise.all([
      this.prisma.baseClient.$queryRaw<
        Array<{
          id: string;
          name: string;
          quantity: number;
          min_quantity: number;
          unit: string | null;
        }>
      >`
        SELECT id, name, quantity, min_quantity, unit
        FROM inventory_items
        WHERE quantity <= min_quantity AND is_active = true
        ORDER BY (quantity - min_quantity) ASC
        LIMIT 10
      `,
      this.prisma.baseClient.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM inventory_items
        WHERE quantity <= min_quantity AND is_active = true
      `,
    ]);
    return {
      lowStockCount: Number(countRows[0]?.count ?? lowStock.length),
      lowStock: lowStock.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        minQuantity: i.min_quantity,
        unit: i.unit,
      })),
    };
  }
}
