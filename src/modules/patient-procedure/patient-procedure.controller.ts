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
  RequireAnyPermission,
  RequirePermissions,
} from '@common/decorators';
import { PatientProcedureService } from './patient-procedure.service';
import { CreatePatientProcedureDto } from './dto/create-patient-procedure.dto';
import { UpdatePatientProcedureDto } from './dto/update-patient-procedure.dto';
import { TransitionPatientProcedureDto } from './dto/transition-patient-procedure.dto';
import { LinkToAppointmentDto } from './dto/link-to-appointment.dto';
import { FinalizeFeeDto } from './dto/finalize-fee.dto';
import { PromoteToPlanDto } from './dto/promote-to-plan.dto';
import { PatientProcedureQueryDto } from './dto/patient-procedure-query.dto';

@Controller('patient-procedures')
export class PatientProcedureController {
  constructor(private readonly service: PatientProcedureService) {}

  @Get()
  @RequirePermissions('patient_procedures:read')
  findAll(@Query() query: PatientProcedureQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('patient_procedures:read')
  @AuditAccess('PATIENT_PROCEDURE_VIEWED', {
    paramKey: 'id',
    resource: 'patient_procedure',
    debounceSeconds: 60,
  })
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @RequirePermissions('patient_procedures:create')
  @AuditMutation({
    code: 'PATIENT_PROCEDURE_CREATED',
    resource: 'patient_procedure',
  })
  create(@Body() dto: CreatePatientProcedureDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('patient_procedures:update')
  @AuditMutation({
    code: 'PATIENT_PROCEDURE_UPDATED',
    resource: 'patient_procedure',
  })
  update(@Param('id') id: string, @Body() dto: UpdatePatientProcedureDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/transition')
  @RequireAnyPermission(
    'patient_procedures:update',
    'patient_procedures:cancel',
    'patient_procedures:complete',
  )
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionPatientProcedureDto,
  ) {
    return this.service.transition(id, dto);
  }

  @Post(':id/link-appointment')
  @RequirePermissions('patient_procedures:update')
  linkToAppointment(
    @Param('id') id: string,
    @Body() dto: LinkToAppointmentDto,
  ) {
    return this.service.linkToAppointment(id, dto);
  }

  @Post(':id/unlink-appointment')
  @RequirePermissions('patient_procedures:update')
  unlinkFromAppointment(@Param('id') id: string) {
    return this.service.unlinkFromAppointment(id);
  }

  @Post(':id/finalize-fee')
  @RequireAnyPermission(
    'patient_procedures:finalize_fee',
    'patient_procedures:finalize_fee:override',
  )
  @AuditMutation({
    code: 'PATIENT_PROCEDURE_FEE_FINALIZED',
    resource: 'patient_procedure',
  })
  finalizeFee(@Param('id') id: string, @Body() dto: FinalizeFeeDto) {
    return this.service.finalizeFee(id, dto);
  }

  @Post(':id/promote-to-plan')
  @RequirePermissions('patient_procedures:promote_to_plan')
  @AuditMutation({
    code: 'PATIENT_PROCEDURE_PROMOTED_TO_PLAN',
    resource: 'patient_procedure',
  })
  promoteToTreatmentPlan(
    @Param('id') id: string,
    @Body() dto: PromoteToPlanDto,
  ) {
    return this.service.promoteToTreatmentPlan(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('patient_procedures:cancel')
  softDelete(@Param('id') id: string) {
    return this.service.softDelete(id);
  }
}
