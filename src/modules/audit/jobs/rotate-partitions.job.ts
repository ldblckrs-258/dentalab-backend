import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';

@Injectable()
export class RotatePartitionsJob {
  private readonly logger = new Logger(RotatePartitionsJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async ensureUpcomingPartitions(): Promise<void> {
    const monthsAhead = 3;
    const start = new Date();
    this.logger.log(
      `Partition maintenance (hot retention ${this.config.queue.AUDIT_HOT_RETENTION_DAYS}d): ensure ${monthsAhead} future months`,
    );
    for (let i = 0; i < monthsAhead; i++) {
      const d = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1),
      );
      const next = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
      );
      const name = `audit_logs_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const from = d.toISOString().slice(0, 10);
      const to = next.toISOString().slice(0, 10);
      try {
        await this.prisma.baseClient.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF audit_logs ` +
            `FOR VALUES FROM ('${from}') TO ('${to}')`,
        );
      } catch (e) {
        this.logger.warn(
          `Partition ${name}: ${(e as Error).message} (may already exist)`,
        );
      }
    }
  }
}
