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
import { TreatmentPlanService } from './treatment-plan.service';
import { CreateTreatmentPlanDto } from './dto/create-treatment-plan.dto';
import { UpdateTreatmentPlanDto } from './dto/update-treatment-plan.dto';
import { TransitionTreatmentPlanDto } from './dto/transition-treatment-plan.dto';
import { CancelTreatmentPlanDto } from './dto/cancel-treatment-plan.dto';
import { TreatmentPlanQueryDto } from './dto/treatment-plan-query.dto';

@Controller('treatment-plans')
export class TreatmentPlanController {
  constructor(private readonly treatmentPlanService: TreatmentPlanService) {}

  @Post()
  @RequirePermissions('treatment_plans:create')
  @AuditMutation({ code: 'TREATMENT_PLAN_CREATED', resource: 'treatment_plan' })
  async create(@Body() dto: CreateTreatmentPlanDto) {
    return this.treatmentPlanService.create(dto);
  }

  @Get()
  @RequireAnyPermission(
    'treatment_plans:read:full',
    'treatment_plans:read:metadata',
  )
  @AuditAccess('TREATMENT_PLAN_VIEWED', { debounceSeconds: 60 })
  async findAll(@Query() query: TreatmentPlanQueryDto) {
    return this.treatmentPlanService.findAll(query);
  }

  @Get(':id')
  @RequireAnyPermission(
    'treatment_plans:read:full',
    'treatment_plans:read:metadata',
  )
  @AuditAccess('TREATMENT_PLAN_VIEWED', { debounceSeconds: 60 })
  async findById(@Param('id') id: string) {
    return this.treatmentPlanService.findById(id);
  }

  @Patch(':id')
  @RequirePermissions('treatment_plans:update')
  @AuditMutation({ code: 'TREATMENT_PLAN_UPDATED', resource: 'treatment_plan' })
  async update(@Param('id') id: string, @Body() dto: UpdateTreatmentPlanDto) {
    return this.treatmentPlanService.update(id, dto);
  }

  @Post(':id/transition')
  @RequirePermissions('treatment_plans:update')
  @AuditMutation({
    code: 'TREATMENT_PLAN_TRANSITIONED',
    resource: 'treatment_plan',
  })
  async transition(
    @Param('id') id: string,
    @Body() dto: TransitionTreatmentPlanDto,
  ) {
    return this.treatmentPlanService.transition(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('treatment_plans:cancel')
  async cancel(@Param('id') id: string, @Body() dto: CancelTreatmentPlanDto) {
    return this.treatmentPlanService.cancel(id, dto.reason);
  }
}

@Controller('patients/:patientId/treatment-plans')
export class PatientTreatmentPlanController {
  constructor(private readonly treatmentPlanService: TreatmentPlanService) {}

  @Get()
  @RequireAnyPermission(
    'treatment_plans:read:full',
    'treatment_plans:read:metadata',
  )
  @AuditAccess('TREATMENT_PLAN_VIEWED', { debounceSeconds: 60 })
  async findByPatientId(@Param('patientId') patientId: string) {
    return this.treatmentPlanService.findByPatientId(patientId);
  }
}
