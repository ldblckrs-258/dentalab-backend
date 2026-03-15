import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PermissionResolverService } from './services/permission-resolver.service';
import { PermissionGuard } from './guards/permission.guard';

@Module({
  controllers: [RbacController],
  providers: [
    RbacService,
    PermissionResolverService,
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
  ],
  exports: [RbacService, PermissionResolverService],
})
export class RbacModule {}
