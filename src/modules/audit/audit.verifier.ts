import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@modules/database';
import { AuditService } from './audit.service';
import { computeAuditHash } from './audit-hash';

@Injectable()
export class AuditVerifierService {
  private readonly logger = new Logger(AuditVerifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async verifyNightly(): Promise<void> {
    const result = await this.verifyChain();
    if (!result.ok) {
      this.logger.error(
        `Audit chain verification failed at offset ${result.brokenOffset}`,
      );
      this.auditService.emit({
        code: 'AUDIT_CHAIN_VERIFICATION_FAILED',
        outcome: 'failure',
        actorType: 'system',
        reason: 'Nightly automated chain verification',
        metadata: { brokenOffset: result.brokenOffset },
      });
    } else {
      this.logger.log('Audit chain verification passed');
    }
  }

  /**
   * Streams rows in `batchSize` chunks using cursor-based pagination to
   * avoid loading the full table into memory (OOM-safe on large datasets).
   */
  async verifyChain(
    batchSize = 2_000,
  ): Promise<{ ok: true } | { ok: false; brokenOffset: number }> {
    let cursorId: string | undefined;
    let cursorCreatedAt: Date | undefined;
    let offset = 0;
    let hashPrev: string | null = null;

    for (;;) {
      const rows = await this.prisma.baseClient.auditLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        skip: cursorId ? 1 : 0,
        cursor: cursorId
          ? { id_createdAt: { id: cursorId, createdAt: cursorCreatedAt! } }
          : undefined,
      });

      if (!rows.length) break;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const expected = computeAuditHash(
          {
            eventCode: row.eventCode,
            eventVersion: row.eventVersion,
            actorId: row.actorId,
            resource: row.resource,
            resourceId: row.resourceId,
            before: row.before,
            after: row.after,
            metadata: row.metadata,
            createdAt: row.createdAt.toISOString(),
          },
          hashPrev,
        );
        if (expected !== row.hashSelf) {
          return { ok: false, brokenOffset: offset + i };
        }
        hashPrev = row.hashSelf;
      }

      offset += rows.length;
      if (rows.length < batchSize) break;
      const last = rows[rows.length - 1];
      cursorId = last.id;
      cursorCreatedAt = last.createdAt;
    }

    return { ok: true };
  }
}
