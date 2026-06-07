import {
  AuditMutation,
  CacheEndpoint,
  InvalidateCache,
  RequirePermissions,
} from '@common/decorators';
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
import { OperatoryAvailabilityQueryDto } from './dto/operatory-availability-query.dto';
import { CreateOperatoryDto } from './dto/create-operatory.dto';
import { OperatoryQueryDto } from './dto/operatory-query.dto';
import { ReorderOperatoriesDto } from './dto/reorder-operatories.dto';
import { UpdateOperatoryDto } from './dto/update-operatory.dto';
import { OperatoryService } from './operatory.service';

@Controller('operatories')
export class OperatoryController {
  constructor(private readonly operatoryService: OperatoryService) {}

  @Get()
  @RequirePermissions('operatories:read')
  @CacheEndpoint({ domain: 'operatories' })
  findAll(@Query() query: OperatoryQueryDto) {
    return this.operatoryService.findAll(query);
  }

  @Get('availability')
  @RequirePermissions('operatories:read')
  async availability(@Query() query: OperatoryAvailabilityQueryDto) {
    const busyOperatoryIds = await this.operatoryService.getBusyOperatoryIds(
      new Date(query.start),
      new Date(query.end),
      query.excludeAppointmentId,
    );
    return { busyOperatoryIds };
  }

  @Get(':id')
  @RequirePermissions('operatories:read')
  @CacheEndpoint({ domain: 'operatories' })
  findById(@Param('id') id: string) {
    return this.operatoryService.findById(id);
  }

  @Post()
  @RequirePermissions('operatories:create')
  @InvalidateCache('operatories')
  @AuditMutation({ code: 'OPERATORY_CREATED', resource: 'operatory' })
  create(@Body() dto: CreateOperatoryDto) {
    return this.operatoryService.create(dto);
  }

  @Patch('reorder')
  @RequirePermissions('operatories:update')
  @InvalidateCache('operatories')
  @AuditMutation({ code: 'OPERATORY_REORDERED', resource: 'operatory' })
  reorder(@Body() dto: ReorderOperatoriesDto) {
    return this.operatoryService.reorder(dto);
  }

  @Patch(':id')
  @RequirePermissions('operatories:update')
  @InvalidateCache('operatories')
  update(@Param('id') id: string, @Body() dto: UpdateOperatoryDto) {
    return this.operatoryService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('operatories:delete')
  @InvalidateCache('operatories')
  @AuditMutation({ code: 'OPERATORY_DISABLED', resource: 'operatory' })
  deactivate(@Param('id') id: string) {
    return this.operatoryService.deactivate(id);
  }
}
