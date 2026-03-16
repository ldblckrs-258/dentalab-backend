import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/database';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
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

const USER_SELECT = { select: { email: true, full_name: true } } as const;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.baseClient.auditLog.create({
        data: {
          user_id: entry.userId,
          action: entry.action,
          resource: entry.resource,
          resource_id: entry.resourceId,
          old_data: entry.oldData as any,
          new_data: entry.newData as any,
          ip_address: entry.ipAddress,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log: ${(error as Error).message}`,
      );
    }
  }

  async findAll(query: AuditQueryDto) {
    const prismaArgs = buildPrismaQuery(
      query,
      ['created_at', 'action', 'resource'],
      { created_at: 'desc' },
    );

    const where: Record<string, unknown> = {};
    if (query.userId) where.user_id = query.userId;
    if (query.action) where.action = query.action;
    if (query.resource) where.resource = query.resource;
    if (query.resourceId) where.resource_id = query.resourceId;
    if (query.ipAddress) where.ip_address = query.ipAddress;
    if (query.from || query.to) {
      where.created_at = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
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

  async findById(id: string) {
    const log = await this.prisma.baseClient.auditLog.findUnique({
      where: { id },
      include: { user: USER_SELECT },
    });
    if (!log) throw new NotFoundException('Audit log not found');
    return log;
  }
}
