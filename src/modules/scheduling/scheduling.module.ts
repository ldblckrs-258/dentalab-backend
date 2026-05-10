import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { AuthModule } from '@modules/auth';
import { RbacModule } from '@modules/rbac';
import { ProviderScheduleService } from './provider-schedule.service';
import { ProviderScheduleController } from './provider-schedule.controller';
import { ScheduleOverrideService } from './schedule-override.service';
import { ScheduleOverrideController } from './schedule-override.controller';
import { ScheduleOverviewService } from './schedule-overview.service';
import { ScheduleOverviewController } from './schedule-overview.controller';
import { ProviderAvailabilityService } from './provider-availability.service';
import { SchedulingConflictService } from './scheduling-conflict.service';
import { SchedulingGateway } from './scheduling.gateway';

@Module({
  imports: [AuditModule, AuthModule, RbacModule],
  controllers: [
    ProviderScheduleController,
    ScheduleOverrideController,
    ScheduleOverviewController,
  ],
  providers: [
    ProviderScheduleService,
    ScheduleOverrideService,
    ScheduleOverviewService,
    ProviderAvailabilityService,
    SchedulingConflictService,
    SchedulingGateway,
  ],
  exports: [
    ProviderScheduleService,
    ScheduleOverrideService,
    ScheduleOverviewService,
    ProviderAvailabilityService,
    SchedulingConflictService,
    SchedulingGateway,
  ],
})
export class SchedulingModule {}
