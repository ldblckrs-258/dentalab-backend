import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { PermissionResolverService } from '@modules/rbac';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import type { AuditQueryDto } from './dto/audit-query.dto';

export interface AuditEntry {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ipAddress?: string;
}

/** Resources belonging to the "Tài nguyên & Vận hành" module (Module 4) */
const OPERATIONS_RESOURCES = [
  'form',
  'kiosk_session',
  'internal_document',
  'document_version',
  'inventory_item',
  'inventory_transaction',
  'email_template',
  'email_log',
  'provider_schedule',
  'schedule_override',
];

const USER_SELECT = { select: { email: true, fullName: true } } as const;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.baseClient.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId,
          oldData: entry.oldData as any,
          newData: entry.newData as any,
          ipAddress: entry.ipAddress,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log: ${(error as Error).message}`,
      );
    }
  }

  async findAll(query: AuditQueryDto, currentUserId: string) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['createdAt', 'action', 'resource'],
      { createdAt: 'desc' },
    );

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.resource) where.resource = query.resource;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.ipAddress) where.ipAddress = query.ipAddress;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    // Scope-based filtering
    const scope = await this.resolveAuditScope(currentUserId);

    if (scope === 'operations') {
      if (query.resource && !OPERATIONS_RESOURCES.includes(query.resource)) {
        throw new ForbiddenException(
          t('rbac.insufficient_permissions', 'Insufficient permissions'),
        );
      }
      if (!query.resource) {
        where.resource = { in: OPERATIONS_RESOURCES };
      }
    } else if (scope === 'own') {
      if (query.userId && query.userId !== currentUserId) {
        throw new ForbiddenException(
          t('rbac.insufficient_permissions', 'Insufficient permissions'),
        );
      }
      where.userId = currentUserId;
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.auditLog.findMany({
        ...prismaArgs,
        where,
        include: { user: USER_SELECT },
      }),
      this.prisma.baseClient.auditLog.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async findById(id: string, currentUserId: string) {
    const log = await this.prisma.baseClient.auditLog.findUnique({
      where: { id },
      include: { user: USER_SELECT },
    });
    if (!log)
      throw new NotFoundException(t('common.not_found', 'Audit log not found'));

    // Scope-based access check
    const scope = await this.resolveAuditScope(currentUserId);

    if (
      scope === 'operations' &&
      !OPERATIONS_RESOURCES.includes(log.resource)
    ) {
      throw new ForbiddenException(
        t('rbac.insufficient_permissions', 'Insufficient permissions'),
      );
    }
    if (scope === 'own' && log.userId !== currentUserId) {
      throw new ForbiddenException(
        t('rbac.insufficient_permissions', 'Insufficient permissions'),
      );
    }

    return log;
  }

  private async resolveAuditScope(
    userId: string,
  ): Promise<'all' | 'operations' | 'own'> {
    const permissions =
      await this.permissionResolver.resolvePermissions(userId);
    if (permissions.includes('audit_logs:read:all')) return 'all';
    if (permissions.includes('audit_logs:read:operations')) return 'operations';
    return 'own';
  }
}
