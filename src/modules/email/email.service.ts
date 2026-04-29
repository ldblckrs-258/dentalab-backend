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
import { t } from '@common/utils';
import { DEFAULT_LANGUAGE } from '@common/constants';
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
    lang?: string;
    entityType?: string;
    entityId?: string;
    attachmentKeys?: string[];
    tags?: { name: string; value: string }[];
    idempotencyKey?: string;
  }): Promise<EmailLog> {
    const lang = params.lang ?? DEFAULT_LANGUAGE;
    const { html, subject } = this.templateService.render(
      params.templateName,
      params.variables,
      lang,
    );

    const attachments = params.attachmentKeys?.length
      ? await this.resolveAttachments(params.attachmentKeys)
      : undefined;

    const fromAddress = this.defaultFrom;

    const log = await this.prisma.baseClient.emailLog.create({
      data: {
        templateName: params.templateName,
        fromAddress: fromAddress,
        recipientEmail: Array.isArray(params.to)
          ? params.to.join(', ')
          : params.to,
        subject,
        status: EMAIL_STATUS.PENDING,
        variables: params.variables as any,
        entityType: params.entityType,
        entityId: params.entityId,
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
          resendId: result.id,
          status: EMAIL_STATUS.SENT,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.baseClient.emailLog.update({
        where: { id: log.id },
        data: {
          status: EMAIL_STATUS.FAILED,
          errorMessage: error instanceof Error ? error.message : String(error),
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
    lang?: string;
    tags?: { name: string; value: string }[];
  }): Promise<EmailLog[]> {
    const batchId = crypto.randomUUID();
    const fromAddress = this.defaultFrom;
    const lang = params.lang ?? DEFAULT_LANGUAGE;

    const rendered = params.recipients.map((r) => {
      const { html, subject } = this.templateService.render(
        params.templateName,
        r.variables,
        lang,
      );
      return { ...r, html, subject };
    });

    const logs = await Promise.all(
      rendered.map((r) =>
        this.prisma.baseClient.emailLog.create({
          data: {
            templateName: params.templateName,
            fromAddress: fromAddress,
            recipientEmail: r.to,
            subject: r.subject,
            status: EMAIL_STATUS.PENDING,
            variables: r.variables as any,
            entityType: r.entityType,
            entityId: r.entityId,
            tags: params.tags as any,
            batchId: batchId,
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

      return Promise.all(
        logs.map((log, i) =>
          this.prisma.baseClient.emailLog.update({
            where: { id: log.id },
            data: {
              resendId: result.results[i]?.id,
              status: EMAIL_STATUS.SENT,
              sentAt: new Date(),
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
              errorMessage:
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
    });
    if (!log)
      throw new NotFoundException(
        t('email.log_not_found', 'Email log not found'),
      );
    if (
      log.status !== EMAIL_STATUS.FAILED &&
      log.status !== EMAIL_STATUS.BOUNCED
    ) {
      throw new BadRequestException(
        t(
          'email.can_only_resend_failed',
          'Can only resend failed or bounced emails',
        ),
      );
    }

    return this.sendTemplatedEmail({
      to: log.recipientEmail,
      templateName: log.templateName,
      variables: (log.variables as Record<string, unknown>) ?? {},
      entityType: log.entityType ?? undefined,
      entityId: log.entityId ?? undefined,
    });
  }

  async findAll(query: EmailQueryDto) {
    const prismaArgs = buildPrismaQuery(query, [
      'recipientEmail',
      'status',
      'createdAt',
      'sentAt',
    ]);

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.templateName) where.templateName = query.templateName;
    if (query.recipientEmail) {
      where.recipientEmail = {
        contains: query.recipientEmail,
        mode: 'insensitive',
      };
    }
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.search) {
      where.OR = [
        {
          recipientEmail: {
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

  async getMetaTemplates(): Promise<string[]> {
    const rows = await this.prisma.baseClient.emailLog.findMany({
      distinct: ['templateName'],
      select: { templateName: true },
      orderBy: { templateName: 'asc' },
    });
    return rows.map((r) => r.templateName);
  }

  async getMetaEntityTypes(): Promise<string[]> {
    const rows = await this.prisma.baseClient.emailLog.findMany({
      distinct: ['entityType'],
      select: { entityType: true },
      where: { entityType: { not: null } },
      orderBy: { entityType: 'asc' },
    });
    return rows.map((r) => r.entityType as string);
  }

  async findOne(id: string) {
    const log = await this.prisma.baseClient.emailLog.findUnique({
      where: { id },
    });
    if (!log)
      throw new NotFoundException(
        t('email.log_not_found', 'Email log not found'),
      );
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
