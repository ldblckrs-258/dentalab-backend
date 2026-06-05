import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDashboard(user, query.range);
  }
}
