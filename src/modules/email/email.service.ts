import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { EmailLog } from '@prisma/client';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';
import { buildPrismaQuery, buildPaginatedResponse } from '@modules/pagination';
import { S3_CLIENT } from '@modules/storage/storage.constants';
import { EMAIL_PROVIDER, EMAIL_STATUS } from './email.constants';
import { TemplateService } from './template/template.service';
import type {
  EmailProvider,
  EmailAttachment,
} from './providers/email-provider.interface';
import type { EmailQueryDto } from './dto/email-query.dto';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly templateService: TemplateService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
  ) {}

  private get defaultFrom(): string {
    return `${this.config.email.EMAIL_FROM_NAME} <${this.config.email.EMAIL_FROM_ADDRESS}>`;
  }

  async sendTemplatedEmail(params: {
    to: string | string[];
    templateName: string;
    variables: Record<string, unknown>;
    entityType?: string;
    entityId?: string;
    attachmentKeys?: string[];
    tags?: { name: string; value: string }[];
    idempotencyKey?: string;
  }): Promise<EmailLog> {
    const { html, subject, templateId } = await this.templateService.render(
      params.templateName,
      params.variables,
    );

    const attachments = params.attachmentKeys?.length
      ? await this.resolveAttachments(params.attachmentKeys)
      : undefined;

    const fromAddress = this.defaultFrom;

    const log = await this.prisma.baseClient.emailLog.create({
      data: {
        template_id: templateId,
        from_address: fromAddress,
        recipient_email: Array.isArray(params.to)
          ? params.to.join(', ')
          : params.to,
        subject,
        status: EMAIL_STATUS.PENDING,
        variables: params.variables as any,
        entity_type: params.entityType,
        entity_id: params.entityId,
        attachments: attachments?.map((a) => ({
          filename: a.filename,
          size: a.content.length,
          content_type: a.contentType,
        })) as any,
        tags: params.tags as any,
      },
    });

    try {
      const result = await this.provider.send({
        from: fromAddress,
        to: params.to,
        subject,
        html,
        attachments,
        tags: params.tags,
        idempotencyKey: params.idempotencyKey,
      });

      return this.prisma.baseClient.emailLog.update({
        where: { id: log.id },
        data: {
          resend_id: result.id,
          status: EMAIL_STATUS.SENT,
          sent_at: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.baseClient.emailLog.update({
        where: { id: log.id },
        data: {
          status: EMAIL_STATUS.FAILED,
          error_message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async sendBatchTemplatedEmail(params: {
    recipients: {
      to: string;
      variables: Record<string, unknown>;
      entityType?: string;
      entityId?: string;
    }[];
    templateName: string;
    tags?: { name: string; value: string }[];
  }): Promise<EmailLog[]> {
    const batchId = crypto.randomUUID();
    const fromAddress = this.defaultFrom;

    // Render template once to get templateId, then render per-recipient for variables
    const first = await this.templateService.render(
      params.templateName,
      params.recipients[0].variables,
    );
    const { templateId } = first;

    // Render each recipient's variables (template is cached after first render)
    const rendered = await Promise.all(
      params.recipients.map(async (r) => {
        const { html, subject } = await this.templateService.render(
          params.templateName,
          r.variables,
        );
        return { ...r, html, subject };
      }),
    );

    // Create log entries
    const logs = await Promise.all(
      rendered.map((r) =>
        this.prisma.baseClient.emailLog.create({
          data: {
            template_id: templateId,
            from_address: fromAddress,
            recipient_email: r.to,
            subject: r.subject,
            status: EMAIL_STATUS.PENDING,
            variables: r.variables as any,
            entity_type: r.entityType,
            entity_id: r.entityId,
            tags: params.tags as any,
            batch_id: batchId,
          },
        }),
      ),
    );

    try {
      const result = await this.provider.sendBatch(
        rendered.map((r) => ({
          from: fromAddress,
          to: r.to,
          subject: r.subject,
          html: r.html,
          tags: params.tags,
        })),
      );

      // Update logs with resend IDs
      return Promise.all(
        logs.map((log, i) =>
          this.prisma.baseClient.emailLog.update({
            where: { id: log.id },
            data: {
              resend_id: result.results[i]?.id,
              status: 'sent',
              sent_at: new Date(),
            },
          }),
        ),
      );
    } catch (error) {
      await Promise.all(
        logs.map((log) =>
          this.prisma.baseClient.emailLog.update({
            where: { id: log.id },
            data: {
              status: EMAIL_STATUS.FAILED,
              error_message:
                error instanceof Error ? error.message : String(error),
            },
          }),
        ),
      );
      throw error;
    }
  }

  async resendEmail(emailLogId: string): Promise<EmailLog> {
    const log = await this.prisma.baseClient.emailLog.findUnique({
      where: { id: emailLogId },
      include: { template: true },
    });
    if (!log) throw new NotFoundException('Email log not found');
    if (
      ![EMAIL_STATUS.FAILED, EMAIL_STATUS.BOUNCED].includes(log.status as any)
    ) {
      throw new BadRequestException('Can only resend failed or bounced emails');
    }

    return this.sendTemplatedEmail({
      to: log.recipient_email,
      templateName: log.template.name,
      variables: (log.variables as Record<string, unknown>) ?? {},
      entityType: log.entity_type ?? undefined,
      entityId: log.entity_id ?? undefined,
    });
  }

  async findAll(query: EmailQueryDto) {
    const prismaArgs = buildPrismaQuery(query, [
      'recipient_email',
      'status',
      'created_at',
      'sent_at',
    ]);

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.templateName) where.template = { name: query.templateName };
    if (query.recipientEmail) {
      where.recipient_email = {
        contains: query.recipientEmail,
        mode: 'insensitive',
      };
    }
    if (query.entityType) where.entity_type = query.entityType;
    if (query.entityId) where.entity_id = query.entityId;
    if (query.search) {
      where.OR = [
        {
          recipient_email: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
        { subject: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.baseClient.emailLog.findMany({
        ...prismaArgs,
        where,
        include: { template: { select: { name: true, type: true } } },
      }),
      this.prisma.baseClient.emailLog.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, query);
  }

  async getStats() {
    const stats = await this.prisma.baseClient.emailLog.groupBy({
      by: ['status'],
      _count: true,
    });

    const result: Record<string, number> = {
      total: 0,
      pending: 0,
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      failed: 0,
    };

    for (const s of stats) {
      result[s.status] = s._count;
      result.total += s._count;
    }

    return result;
  }

  async findOne(id: string) {
    const log = await this.prisma.baseClient.emailLog.findUnique({
      where: { id },
      include: {
        template: { select: { name: true, type: true, subject: true } },
      },
    });
    if (!log) throw new NotFoundException('Email log not found');
    return log;
  }

  private async resolveAttachments(keys: string[]): Promise<EmailAttachment[]> {
    return Promise.all(
      keys.map(async (key) => {
        const response = await this.s3.send(
          new GetObjectCommand({
            Bucket: this.config.storage.S3_BUCKET,
            Key: key,
          }),
        );

        const bodyBytes = await response.Body!.transformToByteArray();
        const filename = key.split('/').pop() ?? key;

        return {
          filename,
          content: Buffer.from(bodyBytes),
          contentType: response.ContentType,
        };
      }),
    );
  }
}
