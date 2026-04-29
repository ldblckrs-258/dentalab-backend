import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PermissionResolverService } from './services/permission-resolver.service';
import { PermissionGuard } from './guards/permission.guard';
import { OwnershipGuard } from './guards/ownership.guard';

@Module({
  imports: [forwardRef(() => AuditModule)],
  controllers: [RbacController],
  providers: [
    RbacService,
    PermissionResolverService,
    OwnershipGuard,
    // PermissionGuard is wired explicitly via main.ts useGlobalGuards() so it
    // always runs after JwtAuthGuard (which sets request.user).
    PermissionGuard,
  ],
  exports: [
    RbacService,
    PermissionResolverService,
    OwnershipGuard,
    PermissionGuard,
  ],
})
export class RbacModule {}
