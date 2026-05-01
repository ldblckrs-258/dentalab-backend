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
import {
  AuditAccess,
  AuditMutation,
  RequirePermissions,
} from '@common/decorators';
import { PatientService } from './patient.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { DeletePatientDto } from './dto/delete-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Get()
  @RequirePermissions('patients:read')
  @AuditAccess('PATIENT_VIEWED', { debounceSeconds: 60 })
  async findAll(@Query() query: PatientQueryDto) {
    return this.patientService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('patients:read')
  @AuditAccess('PATIENT_VIEWED')
  async findById(@Param('id') id: string) {
    return this.patientService.findById(id);
  }

  @Post()
  @RequirePermissions('patients:create')
  @AuditMutation({ code: 'PATIENT_CREATED', resource: 'patient' })
  async create(@Body() dto: CreatePatientDto) {
    return this.patientService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('patients:update')
  @AuditMutation({ code: 'PATIENT_UPDATED', resource: 'patient' })
  async update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patientService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('patients:delete')
  @AuditMutation({ code: 'PATIENT_DELETED', resource: 'patient' })
  async delete(@Param('id') id: string, @Body() dto: DeletePatientDto) {
    return this.patientService.delete(id, dto.reason);
  }
}
