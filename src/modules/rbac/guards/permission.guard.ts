import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  ANY_PERMISSION_KEY,
} from '@common/constants';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { t } from '@common/utils';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for @Public() routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Check @RequirePermissions() — AND logic
    const requiredAll = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Check @RequireAnyPermission() — OR logic
    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permission decorators, allow (opt-in model)
    if (!requiredAll && !requiredAny) return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId) {
      throw new ForbiddenException(
        t('common.no_user_context', 'No user context'),
      );
    }

    if (requiredAll) {
      const hasAll = await this.permissionResolver.hasAllPermissions(
        userId,
        requiredAll,
      );
      if (!hasAll) {
        throw new ForbiddenException(
          t('rbac.insufficient_permissions', 'Insufficient permissions'),
        );
      }
    }

    if (requiredAny) {
      const hasAny = await this.permissionResolver.hasAnyPermission(
        userId,
        requiredAny,
      );
      if (!hasAny) {
        throw new ForbiddenException(
          t('rbac.insufficient_permissions', 'Insufficient permissions'),
        );
      }
    }

    return true;
  }
}
