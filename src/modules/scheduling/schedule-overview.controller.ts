import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '@common/decorators';
import { ScheduleOverviewService } from './schedule-overview.service';
import { ScheduleOverviewQueryDto } from './dto/schedule-overview-query.dto';

@Controller()
export class ScheduleOverviewController {
  constructor(
    private readonly scheduleOverviewService: ScheduleOverviewService,
  ) {}

  @Get('schedule-overview')
  @RequirePermissions('provider_schedules:read', 'schedule_overrides:read')
  async getOverview(@Query() query: ScheduleOverviewQueryDto) {
    return this.scheduleOverviewService.getScheduleOverview(query);
  }
}
