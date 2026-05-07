import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditMutation, RequirePermissions } from '@common/decorators';
import { CurrentUser } from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { ScheduleOverrideService } from './schedule-override.service';
import { ProviderAvailabilityService } from './provider-availability.service';
import { CreateScheduleOverrideDto } from './dto/create-schedule-override.dto';
import { ReviewScheduleOverrideDto } from './dto/review-schedule-override.dto';
import { ScheduleOverrideQueryDto } from './dto/schedule-override-query.dto';

@Controller()
export class ScheduleOverrideController {
  constructor(
    private readonly scheduleOverrideService: ScheduleOverrideService,
    private readonly providerAvailabilityService: ProviderAvailabilityService,
  ) {}

  @Post('schedule-overrides')
  @RequirePermissions('schedule_overrides:create')
  @AuditMutation({
    code: 'SCHEDULE_OVERRIDE_REQUESTED',
    resource: 'schedule_override',
  })
  async create(
    @Body() dto: CreateScheduleOverrideDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.scheduleOverrideService.create(dto, currentUser);
  }

  @Get('schedule-overrides/pending')
  @RequirePermissions('schedule_overrides:review')
  async findPending(@Query() query: ScheduleOverrideQueryDto) {
    return this.scheduleOverrideService.findPending(query);
  }

  @Get('schedule-overrides/me')
  async findMine(
    @Query() query: ScheduleOverrideQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.scheduleOverrideService.findMine(currentUser, query);
  }

  @Get('schedule-overrides/:id')
  @RequirePermissions('schedule_overrides:read')
  async findById(@Param('id') id: string) {
    return this.scheduleOverrideService.findById(id);
  }

  @Get('schedule-overrides')
  @RequirePermissions('schedule_overrides:read')
  async findAll(@Query() query: ScheduleOverrideQueryDto) {
    return this.scheduleOverrideService.findAll(query);
  }

  @Post('schedule-overrides/:id/review')
  @RequirePermissions('schedule_overrides:review')
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewScheduleOverrideDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.scheduleOverrideService.review(id, dto, currentUser);
  }

  @Post('schedule-overrides/:id/cancel')
  @RequirePermissions('schedule_overrides:cancel')
  @AuditMutation({
    code: 'SCHEDULE_OVERRIDE_CANCELLED',
    resource: 'schedule_override',
  })
  async cancel(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.scheduleOverrideService.cancel(id, currentUser);
  }

  @Get('providers/:providerId/availability')
  @RequirePermissions('provider_schedules:read')
  async getAvailability(
    @Param('providerId') providerId: string,
    @Query('date') date: string,
  ) {
    return this.providerAvailabilityService.getAvailability(providerId, date);
  }
}
