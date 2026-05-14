import {
  AuditMutation,
  CurrentUser,
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
import { AppointmentTypeService } from './appointment-type.service';
import { AppointmentTypeQueryDto } from './dto/appointment-type-query.dto';
import { CreateAppointmentTypeDto } from './dto/create-appointment-type.dto';
import { UpdateAppointmentTypeDto } from './dto/update-appointment-type.dto';

@Controller('appointment-types')
export class AppointmentTypeController {
  constructor(
    private readonly appointmentTypeService: AppointmentTypeService,
  ) {}

  @Get()
  @RequirePermissions('appointment_types:read')
  findAll(@Query() query: AppointmentTypeQueryDto) {
    return this.appointmentTypeService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('appointment_types:read')
  findById(@Param('id') id: string) {
    return this.appointmentTypeService.findById(id);
  }

  @Post()
  @RequirePermissions('appointment_types:create')
  @AuditMutation({
    code: 'APPOINTMENT_TYPE_CREATED',
    resource: 'appointment_type',
  })
  async create(
    @Body() dto: CreateAppointmentTypeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.appointmentTypeService.create(dto, userId);
  }

  @Patch(':id')
  @RequirePermissions('appointment_types:update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentTypeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.appointmentTypeService.update(id, dto, userId);
  }

  @Delete(':id')
  @RequirePermissions('appointment_types:delete')
  @AuditMutation({
    code: 'APPOINTMENT_TYPE_DISABLED',
    resource: 'appointment_type',
  })
  async deactivate(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.appointmentTypeService.deactivate(id, userId);
  }
}
