import { Module } from '@nestjs/common';
import { RbacModule } from '@modules/rbac';
import { AuditModule } from '@modules/audit';
import { PatientProcedureController } from './patient-procedure.controller';
import { PatientProcedureService } from './patient-procedure.service';

@Module({
  imports: [RbacModule, AuditModule],
  controllers: [PatientProcedureController],
  providers: [PatientProcedureService],
  exports: [PatientProcedureService],
})
export class PatientProcedureModule {}
