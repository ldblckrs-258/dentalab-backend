import { Module } from '@nestjs/common';
import { RbacModule } from '@modules/rbac';
import { AuditModule } from '@modules/audit';
import {
  TreatmentPlanController,
  PatientTreatmentPlanController,
} from './treatment-plan.controller';
import { TreatmentPlanService } from './treatment-plan.service';

@Module({
  imports: [RbacModule, AuditModule],
  controllers: [TreatmentPlanController, PatientTreatmentPlanController],
  providers: [TreatmentPlanService],
  exports: [TreatmentPlanService],
})
export class TreatmentPlanModule {}
