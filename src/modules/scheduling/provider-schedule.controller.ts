import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AuditMutation, RequirePermissions } from '@common/decorators';
import { ProviderScheduleService } from './provider-schedule.service';
import { CreateProviderScheduleDto } from './dto/create-provider-schedule.dto';
import { ProviderScheduleQueryDto } from './dto/provider-schedule-query.dto';
import { UpdateProviderScheduleDto } from './dto/update-provider-schedule.dto';
import { ReplaceProviderSchedulesDto } from './dto/replace-provider-schedules.dto';

@Controller()
export class ProviderScheduleController {
  constructor(
    private readonly providerScheduleService: ProviderScheduleService,
  ) {}

  @Get('provider-schedules')
  @RequirePermissions('provider_schedules:read')
  async findAll(@Query() query: ProviderScheduleQueryDto) {
    return this.providerScheduleService.findAll(query);
  }

  @Get('providers/:providerId/schedules')
  @RequirePermissions('provider_schedules:read')
  async findByProvider(
    @Param('providerId') providerId: string,
    @Query('onlyAvailable') onlyAvailable?: string,
  ) {
    const isAvailable =
      onlyAvailable === 'true'
        ? true
        : onlyAvailable === 'false'
          ? false
          : undefined;
    return this.providerScheduleService.findForProvider(
      providerId,
      isAvailable,
    );
  }

  @Post('provider-schedules')
  @RequirePermissions('provider_schedules:create')
  @AuditMutation({
    code: 'PROVIDER_SCHEDULE_CREATED',
    resource: 'provider_schedule',
  })
  async create(@Body() dto: CreateProviderScheduleDto) {
    return this.providerScheduleService.create(dto);
  }

  @Put('providers/:providerId/schedules')
  @RequirePermissions('provider_schedules:update')
  @AuditMutation({
    code: 'PROVIDER_SCHEDULE_BULK_REPLACED',
    resource: 'provider_schedule',
  })
  async replaceForProvider(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: ReplaceProviderSchedulesDto,
  ) {
    return this.providerScheduleService.replaceForProvider(providerId, dto);
  }

  @Patch('provider-schedules/:id')
  @RequirePermissions('provider_schedules:update')
  @AuditMutation({
    code: 'PROVIDER_SCHEDULE_UPDATED',
    resource: 'provider_schedule',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProviderScheduleDto,
  ) {
    return this.providerScheduleService.update(id, dto);
  }

  @Delete('provider-schedules/:id')
  @RequirePermissions('provider_schedules:delete')
  @AuditMutation({
    code: 'PROVIDER_SCHEDULE_DELETED',
    resource: 'provider_schedule',
  })
  async delete(@Param('id') id: string) {
    return this.providerScheduleService.delete(id);
  }
}
