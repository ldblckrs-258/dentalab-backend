import {
  AuditMutation,
  RequireAnyPermission,
  RequirePermissions,
} from '@common/decorators';
import { BatchAvailabilityQueryDto } from '@modules/scheduling/dto/batch-availability-query.dto';
import { ProviderAvailabilityService } from '@modules/scheduling/provider-availability.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BulkUpdateProviderStatusDto } from './dto/bulk-update-provider-status.dto';
import { CreateProviderDto } from './dto/create-provider.dto';
import { ProviderQueryDto } from './dto/provider-query.dto';
import { UpdateProviderStatusDto } from './dto/update-provider-status.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { ProviderService } from './provider.service';

@Controller('providers')
export class ProviderController {
  constructor(
    private readonly providerService: ProviderService,
    private readonly providerAvailabilityService: ProviderAvailabilityService,
  ) {}

  @Get()
  @RequireAnyPermission(
    'providers:read',
    'provider_schedules:read',
    'appointments:read',
  )
  async findAll(@Query() query: ProviderQueryDto) {
    return this.providerService.findAll(query);
  }

  @Get('availability')
  @RequireAnyPermission(
    'provider_schedules:read',
    'providers:read',
    'appointments:read',
  )
  async getBatchAvailability(@Query() query: BatchAvailabilityQueryDto) {
    return this.providerAvailabilityService.getBatchAvailability(
      query.providerIds,
      query.from,
      query.to,
    );
  }

  @Get(':id')
  @RequireAnyPermission(
    'providers:read',
    'provider_schedules:read',
    'appointments:read',
  )
  async findById(@Param('id') id: string) {
    return this.providerService.findById(id);
  }

  @Post()
  @RequirePermissions('providers:create')
  @AuditMutation({ code: 'PROVIDER_CREATED', resource: 'provider' })
  async create(@Body() dto: CreateProviderDto) {
    return this.providerService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('providers:update')
  @AuditMutation({ code: 'PROVIDER_UPDATED', resource: 'provider' })
  async update(@Param('id') id: string, @Body() dto: UpdateProviderDto) {
    return this.providerService.update(id, dto);
  }

  @Post('bulk-status')
  @RequirePermissions('providers:update')
  @AuditMutation({
    code: 'PROVIDER_BULK_STATUS_CHANGED',
    resource: 'provider',
  })
  async bulkUpdateStatus(@Body() dto: BulkUpdateProviderStatusDto) {
    return this.providerService.bulkUpdateStatus(dto);
  }

  @Patch(':id/status')
  @RequirePermissions('providers:update')
  @AuditMutation({ code: 'PROVIDER_UPDATED', resource: 'provider' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProviderStatusDto,
  ) {
    return this.providerService.updateStatus(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('providers:delete')
  @AuditMutation({ code: 'PROVIDER_DELETED', resource: 'provider' })
  async delete(@Param('id') id: string) {
    return this.providerService.delete(id);
  }
}
