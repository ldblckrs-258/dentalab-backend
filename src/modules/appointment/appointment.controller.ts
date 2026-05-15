import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '@common/decorators';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { TransitionStatusDto } from './dto/transition-status.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';

@Controller('appointments')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @RequirePermissions('appointments:create')
  async create(@Body() dto: CreateAppointmentDto) {
    return this.appointmentService.create(dto);
  }

  @Get()
  @RequirePermissions('appointments:read')
  async findAll(@Query() query: ListAppointmentsQueryDto) {
    return this.appointmentService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('appointments:read')
  async findById(@Param('id') id: string) {
    return this.appointmentService.findById(id);
  }

  @Patch(':id')
  @RequirePermissions('appointments:update')
  async update(@Param('id') id: string, @Body() dto: UpdateAppointmentDto) {
    return this.appointmentService.update(id, dto);
  }

  @Patch(':id/reschedule')
  @RequirePermissions('appointments:update')
  async reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentService.reschedule(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('appointments:update')
  async cancel(@Param('id') id: string, @Body() dto: CancelAppointmentDto) {
    return this.appointmentService.cancel(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('appointments:update')
  async transitionStatus(
    @Param('id') id: string,
    @Body() dto: TransitionStatusDto,
  ) {
    return this.appointmentService.transitionStatus(id, dto);
  }
}
