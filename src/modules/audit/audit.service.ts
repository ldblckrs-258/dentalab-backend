import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '@modules/database';
import { PermissionResolverService } from '@modules/rbac';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { t } from '@common/utils';
import { AppConfigService } from '@modules/config';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { AUDIT_EVENTS, type AuditEventCode } from './audit-events';
import { getAuditActorContext } from './audit-context';
import { redactByResource } from './redaction-rules';
import { AuditLogRepository } from './repositories/audit-log.repository';
import type { AuditEventInput } from './audit.types';
import type { AuditQueryDto } from './dto/audit-query.dto';

const OPERATIONS_RESOURCES = [
  'internal_document',
  'document_version',
  'inventory_item',
  'inventory_transaction',
  'email_log',
  'provider_schedule',
  'schedule_override',
];

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);
  private permissionResolver!: PermissionResolverService;

  constructor(
    private readonly auditLogRepository: AuditLogRepository,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    // Resolved after all modules initialize to break the Audit ↔ Rbac circular dep.
    this.permissionResolver = this.moduleRef.get(PermissionResolverService, {
      strict: false,
    });
  }

  emit<C extends AuditEventCode>(input: AuditEventInput<C>): void {
    const def = AUDIT_EVENTS[input.code];
    if (
      'reasonRequired' in def &&
      def.reasonRequired &&
      !input.reason?.trim()
    ) {
      throw new BadRequestException(
        t('validation.required', 'Reason is required for this audit event'),
      );
    }

    // Fire-and-forget: write to the connection pool without blocking the
    // caller. Audit-write failures must never propagate out — they only log.
    const row = this.buildRow(input);
    void this.auditLogRepository.create(row).catch((e) => {
      this.logger.error(`Audit save failed: ${(e as Error).message}`);
    });
  }

  emitFailure(
    code: AuditEventCode,
    error: Error,
    ctx?: Omit<Partial<AuditEventInput>, 'code' | 'outcome'>,
  ): void {
    this.emit({
      ...ctx,
      code,
      outcome: 'failure',
      metadata: {
        ...(ctx?.metadata ?? {}),
        message: error.message,
        name: error.name,
      },
    });
  }

  private buildRow<C extends AuditEventCode>(input: AuditEventInput<C>) {
    const def = AUDIT_EVENTS[input.code];
    const actx = getAuditActorContext();
    const hmacKey = this.config.queue.AUDIT_REDACTION_HMAC_KEY;

    const before = input.resource
      ? redactByResource(input.resource, input.before, hmacKey)
      : input.before;
    const after = input.resource
      ? redactByResource(input.resource, input.after, hmacKey)
      : input.after;

    return {
      id: uuidv4(),
      eventCode: input.code,
      eventVersion: 1,
      category: def.category,
      severity: def.severity,
      outcome: input.outcome ?? 'success',
      actorType: input.actorType ?? 'user',
      actorId: input.actorId ?? actx.actorId ?? null,
      actorEmail: input.actorEmail ?? actx.actorEmail ?? null,
      actorRoleCodes: actx.actorRoleCodes,
      sessionId: input.sessionId ?? actx.sessionId ?? null,
      requestId: input.requestId ?? actx.requestId ?? null,
      resource: input.resource ?? null,
      resourceId: input.resourceId ?? null,
      parentResource: input.parentResource ?? null,
      parentId: input.parentId ?? null,
      before: (before ?? Prisma.DbNull) as Prisma.InputJsonValue,
      after: (after ?? Prisma.DbNull) as Prisma.InputJsonValue,
      metadata: (input.metadata ?? Prisma.DbNull) as Prisma.InputJsonValue,
      ipAddress: input.ipAddress ?? actx.ipAddress ?? null,
      userAgent: input.userAgent ?? actx.userAgent ?? null,
      source: input.source ?? 'api',
      reason: input.reason ?? null,
      createdAt: new Date(),
    };
  }

  async findAll(query: AuditQueryDto, currentUserId: string) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['createdAt', 'eventCode', 'resource'],
      { createdAt: 'desc' },
    ) as unknown as Record<string, unknown>;
    delete prismaArgs.cursor;

    const where: Record<string, unknown> = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.eventCode) where.eventCode = query.eventCode;
    if (query.category) where.category = query.category;
    if (query.severity) where.severity = query.severity;
    if (query.outcome) where.outcome = query.outcome;
    if (query.resource) where.resource = query.resource;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.ipAddress) where.ipAddress = query.ipAddress;
    if (query.actorRoleCode) {
      where.actorRoleCodes = { has: query.actorRoleCode };
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const permissions =
      await this.permissionResolver.resolvePermissions(currentUserId);
    const scope = this.resolveAuditScope(permissions);
    const canReadPhi =
      permissions.includes('audit_logs:read:phi') ||
      permissions.includes('audit_logs:read:all');

    if (!canReadPhi) {
      where.category = { not: 'phi' };
    }

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
      if (query.actorId && query.actorId !== currentUserId) {
        throw new ForbiddenException(
          t('rbac.insufficient_permissions', 'Insufficient permissions'),
        );
      }
      where.actorId = currentUserId;
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.auditLog.findMany({
        ...prismaArgs,
        where,
      }),
      this.prisma.baseClient.auditLog.count({ where }),
    ]);

    const enriched = await this.attachActorNames(data);
    return buildPaginatedResponse(enriched, total, query);
  }

  private async attachActorNames<
    T extends { actorId: string | null; actorType: string },
  >(rows: T[]): Promise<(T & { actorName: string | null })[]> {
    const ids = [
      ...new Set(
        rows
          .filter((r) => r.actorType === 'user' && r.actorId)
          .map((r) => r.actorId as string),
      ),
    ];
    const users = ids.length
      ? await this.prisma.baseClient.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({
      ...r,
      actorName: r.actorId ? (nameById.get(r.actorId) ?? null) : null,
    }));
  }

  async findById(id: string, currentUserId: string) {
    const log = await this.prisma.baseClient.auditLog.findFirst({
      where: { id },
      orderBy: { createdAt: 'desc' },
    });
    if (!log)
      throw new NotFoundException(t('common.not_found', 'Audit log not found'));

    const permissions =
      await this.permissionResolver.resolvePermissions(currentUserId);
    const scope = this.resolveAuditScope(permissions);
    const canReadPhi =
      permissions.includes('audit_logs:read:phi') ||
      permissions.includes('audit_logs:read:all');

    if (!canReadPhi && log.category === 'phi') {
      throw new ForbiddenException(
        t('rbac.insufficient_permissions', 'Insufficient permissions'),
      );
    }

    if (
      scope === 'operations' &&
      log.resource &&
      !OPERATIONS_RESOURCES.includes(log.resource)
    ) {
      throw new ForbiddenException(
        t('rbac.insufficient_permissions', 'Insufficient permissions'),
      );
    }
    if (scope === 'own' && log.actorId !== currentUserId) {
      throw new ForbiddenException(
        t('rbac.insufficient_permissions', 'Insufficient permissions'),
      );
    }

    const [enriched] = await this.attachActorNames([log]);
    return enriched;
  }

  private resolveAuditScope(
    permissions: string[],
  ): 'all' | 'operations' | 'own' {
    if (permissions.includes('audit_logs:read:all')) return 'all';
    if (permissions.includes('audit_logs:read:operations')) return 'operations';
    return 'own';
  }
}
