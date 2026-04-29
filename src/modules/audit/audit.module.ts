import { Module, forwardRef } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RbacModule } from '@modules/rbac';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { AuditController } from './audit.controller';
import { AuditLogRepository } from './repositories/audit-log.repository';
import { AuditWorkerService } from './audit.worker';
import { AuditVerifierService } from './audit.verifier';
import { RotatePartitionsJob } from './jobs/rotate-partitions.job';

@Module({
  imports: [forwardRef(() => RbacModule)],
  controllers: [AuditController],
  providers: [
    AuditLogRepository,
    AuditService,
    AuditWorkerService,
    AuditVerifierService,
    RotatePartitionsJob,
    AuditInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
