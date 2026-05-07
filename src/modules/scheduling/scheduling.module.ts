import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { ProviderScheduleService } from './provider-schedule.service';
import { ProviderScheduleController } from './provider-schedule.controller';
import { ScheduleOverrideService } from './schedule-override.service';
import { ScheduleOverrideController } from './schedule-override.controller';
import { ProviderAvailabilityService } from './provider-availability.service';

@Module({
  imports: [AuditModule],
  controllers: [ProviderScheduleController, ScheduleOverrideController],
  providers: [
    ProviderScheduleService,
    ScheduleOverrideService,
    ProviderAvailabilityService,
  ],
  exports: [
    ProviderScheduleService,
    ScheduleOverrideService,
    ProviderAvailabilityService,
  ],
})
export class SchedulingModule {}
