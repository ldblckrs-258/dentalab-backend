import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/database';

export interface AuditEntry {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditFilter {
  userId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

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

  async findAll(filters: AuditFilter) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters.userId) where.user_id = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.resource) where.resource = filters.resource;
    if (filters.resourceId) where.resource_id = filters.resourceId;
    if (filters.startDate || filters.endDate) {
      where.created_at = {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.baseClient.auditLog.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }
}
