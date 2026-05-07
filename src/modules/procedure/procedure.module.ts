import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { ProcedureController } from './procedure.controller';
import { ProcedureService } from './procedure.service';

@Module({
  imports: [AuditModule],
  controllers: [ProcedureController],
  providers: [ProcedureService],
  exports: [ProcedureService],
})
export class ProcedureModule {}
