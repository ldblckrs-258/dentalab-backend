import { OWNERSHIP_KEY } from '@common/constants';
import type { OwnershipConfig } from '@common/decorators/ownership.decorator';
import { PrismaService } from '@modules/database';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { t } from '@common/utils';

@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<OwnershipConfig>(
      OWNERSHIP_KEY,
      context.getHandler(),
    );
    if (!config) return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId)
      throw new ForbiddenException(
        t('common.no_user_context', 'No user context'),
      );

    // Check bypass permission first
    if (config.bypassPermission) {
      const canBypass = await this.permissionResolver.hasPermission(
        userId,
        config.bypassPermission,
      );
      if (canBypass) return true;
    }

    const resourceId = request.params[config.paramKey || 'id'] as string;
    if (!resourceId)
      throw new ForbiddenException(
        t('common.resource_id_not_found', 'Resource ID not found'),
      );

    const isOwner =
      'through' in config
        ? await this.checkIndirectOwnership(userId, resourceId, config)
        : await this.checkDirectOwnership(userId, resourceId, config);

    if (!isOwner) {
      throw new ForbiddenException(
        t('rbac.own_resources_only', 'You can only access your own resources'),
      );
    }

    return true;
  }

  private async checkDirectOwnership(
    userId: string,
    resourceId: string,
    config: OwnershipConfig,
  ): Promise<boolean> {
    const resource = await (this.prisma.baseClient as any)[
      config.model
    ].findFirst({
      where: {
        id: resourceId,
        [config.ownerField]: userId,
        isActive: true,
      },
      select: { id: true },
    });
    return !!resource;
  }

  private async checkIndirectOwnership(
    userId: string,
    resourceId: string,
    config: OwnershipConfig & {
      through: { model: string; foreignKey?: string; userField: string };
    },
  ): Promise<boolean> {
    const foreignKey = config.through.foreignKey || 'id';

    // Find the intermediate entity that belongs to this user
    const intermediate = await (this.prisma.baseClient as any)[
      config.through.model
    ].findFirst({
      where: {
        [config.through.userField]: userId,
        isActive: true,
      },
      select: { [foreignKey]: true },
    });
    if (!intermediate) return false;

    const intermediateId = intermediate[foreignKey];

    // Check if the resource belongs to this intermediate entity
    const resource = await (this.prisma.baseClient as any)[
      config.model
    ].findFirst({
      where: {
        id: resourceId,
        [config.ownerField]: intermediateId,
        isActive: true,
      },
      select: { id: true },
    });
    return !!resource;
  }
}
