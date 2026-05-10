interface ProviderHeader {
  id: string;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  specialty: string | null;
}

interface ScheduleEntry {
  id: string;
  providerId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

interface OverrideEntry {
  id: string;
  providerId: string;
  specificDate: string;
  overrideType: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  reason: string | null;
  targetScheduleId: string | null;
  isStale: boolean;
}

interface AppointmentCount {
  providerId: string;
  date: string;
  count: number;
}

export class ScheduleOverviewResponse {
  providers: ProviderHeader[];
  schedules: ScheduleEntry[];
  overrides: OverrideEntry[];
  appointmentCounts: AppointmentCount[];
}
