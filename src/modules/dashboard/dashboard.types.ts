import type { DashboardRange } from './dto/dashboard-query.dto';

export interface KpiValue {
  value: number;
  deltaPct?: number;
}

export interface ScheduleItem {
  id: string;
  startTime: string;
  endTime: string;
  patientName: string;
  providerName: string;
  typeName: string;
  status: string;
}

export interface PendingNote {
  id: string;
  patientName: string;
  createdAt: string;
}

export interface RevenuePoint {
  date: string;
  total: number;
}

export interface LowStockItem {
  id: string;
  name: string;
  quantity: number;
  minQuantity: number;
  unit: string | null;
}

export interface PatientLite {
  id: string;
  fullName: string;
  createdAt: string;
}

export interface DashboardResponse {
  range: DashboardRange;
  scoped: boolean;
  appointments?: {
    today: Record<string, number>;
    todayCount: number;
    futureCount: number;
    schedule: ScheduleItem[];
  };
  clinicalNotes?: { pendingCount: number; pending: PendingNote[] };
  treatmentPlans?: { activeCount: number; byStatus: Record<string, number> };
  patients?: {
    newInRange: KpiValue;
    activeTotal: number;
    recent: PatientLite[];
  };
  revenue?: { inRange: KpiValue; trend: RevenuePoint[] };
  pipeline?: { estimatedPlanned: number };
  inventory?: { lowStockCount: number; lowStock: LowStockItem[] };
}
