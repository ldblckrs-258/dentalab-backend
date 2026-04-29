import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '@modules/config';
import {
  QUEUE_AUDIT_WRITE,
  RABBITMQ_CHANNEL,
} from '@modules/queue/queue.constants';
import type { QueueMessage } from '@modules/queue/interfaces/queue-message.interface';
import { PrismaService } from '@modules/database';
import { computeAuditHash } from './audit-hash';
import { AuditLogRepository } from './repositories/audit-log.repository';
import type { AuditEventQueuePayload } from './audit.types';

/** pg_advisory_xact_lock(key1, key2) — ensures single-writer hash chain. */
const ADVISORY_LOCK_KEY1 = 5829102;
const ADVISORY_LOCK_KEY2 = 1039482;

@Injectable()
export class AuditWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditWorkerService.name);
  private consumerTag: string | null = null;
  private buffer: ConsumeMessage[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel | null,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.channel) {
      this.logger.warn('Audit worker disabled: no RabbitMQ channel');
      return;
    }
    const { consumerTag } = await this.channel.consume(
      QUEUE_AUDIT_WRITE,
      (msg) => this.enqueue(msg),
      { exclusive: true, noAck: false },
    );
    this.consumerTag = consumerTag;
    this.logger.log('Audit worker consuming (exclusive)');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.channel && this.consumerTag) {
      await this.channel.cancel(this.consumerTag);
    }
  }

  private enqueue(msg: ConsumeMessage | null): void {
    if (!msg) return;
    this.buffer.push(msg);
    const max = this.config.queue.AUDIT_BATCH_MAX;
    const interval = this.config.queue.AUDIT_BATCH_INTERVAL_MS;
    if (this.buffer.length >= max) {
      void this.flushBatch();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flushBatch();
      }, interval);
    }
  }

  private async flushBatch(): Promise<void> {
    if (this.flushing || !this.channel || !this.buffer.length) return;
    this.flushing = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      await this.prisma.baseClient.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY1}, ${ADVISORY_LOCK_KEY2})`;

        let hashPrev = await this.auditLogRepository.findLastHashSelf(tx);

        const rows: Prisma.AuditLogCreateManyInput[] = [];

        for (const msg of batch) {
          let envelope: QueueMessage;
          let payload: AuditEventQueuePayload;
          try {
            envelope = JSON.parse(msg.content.toString()) as QueueMessage;
            payload = envelope.payload as AuditEventQueuePayload;
          } catch {
            this.logger.warn('Skipping malformed audit message');
            continue;
          }

          const createdAt = new Date(payload.createdAt);
          const hashSelf = computeAuditHash(
            {
              eventCode: payload.eventCode,
              eventVersion: payload.eventVersion,
              actorId: payload.actorId ?? null,
              resource: payload.resource ?? null,
              resourceId: payload.resourceId ?? null,
              before: payload.before ?? null,
              after: payload.after ?? null,
              metadata: payload.metadata ?? null,
              createdAt: createdAt.toISOString(),
            },
            hashPrev,
          );

          rows.push({
            id: payload.id,
            eventCode: payload.eventCode,
            eventVersion: payload.eventVersion,
            category: payload.category,
            severity: payload.severity,
            outcome: payload.outcome,
            actorType: payload.actorType,
            actorId: payload.actorId,
            actorEmail: payload.actorEmail,
            actorRoleCodes: payload.actorRoleCodes,
            sessionId: payload.sessionId,
            requestId: payload.requestId,
            resource: payload.resource,
            resourceId: payload.resourceId,
            parentResource: payload.parentResource,
            parentId: payload.parentId,
            before:
              payload.before === undefined
                ? undefined
                : (payload.before as object),
            after:
              payload.after === undefined
                ? undefined
                : (payload.after as object),
            metadata:
              payload.metadata === undefined
                ? undefined
                : (payload.metadata as object),
            ipAddress: payload.ipAddress,
            userAgent: payload.userAgent,
            source: payload.source,
            reason: payload.reason,
            hashPrev,
            hashSelf,
            createdAt,
          });
          hashPrev = hashSelf;
        }

        if (rows.length) {
          await this.auditLogRepository.createManyAuditLogs(rows, tx);
        }
      });

      for (const msg of batch) {
        this.channel.ack(msg);
      }
    } catch (e) {
      this.logger.error(`Audit batch failed: ${(e as Error).message}`);
      for (const msg of batch) {
        this.channel.nack(msg, false, true);
      }
    } finally {
      this.flushing = false;
    }
  }
}
