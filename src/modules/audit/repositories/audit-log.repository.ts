import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/database';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the hash_self of the most recent audit row.
   * The WHERE predicate on created_at allows Postgres to prune all but the
   * current and previous month's partitions, avoiding a full cross-partition scan.
   */
  async findLastHashSelf(tx?: TxClient): Promise<string | null> {
    const client = (tx ??
      this.prisma.baseClient) as typeof this.prisma.baseClient;
    const rows = await (client as any).$queryRaw<{ hash_self: string }[]>`
      SELECT hash_self FROM audit_logs
      WHERE created_at >= date_trunc('month', now()) - interval '1 month'
      ORDER BY created_at DESC LIMIT 1
    `;
    return rows[0]?.hash_self ?? null;
  }

  async createManyAuditLogs(
    rows: Prisma.AuditLogCreateManyInput[],
    tx?: TxClient,
  ): Promise<void> {
    if (!rows.length) return;
    const client = tx ?? this.prisma.baseClient;
    await client.auditLog.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }
}
