import {
  Controller,
  Post,
  Headers,
  RawBody,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Webhook } from 'svix';
import { PrismaService } from '@modules/database';
import { AppConfigService } from '@modules/config';
import { Public } from '@common/decorators/public.decorator';
import { SkipResponseWrap } from '@common/decorators/skip-response-wrap.decorator';
import { EMAIL_STATUS, WEBHOOK_EVENT_TYPE } from './email.constants';

@Controller('webhooks/email')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);

  private readonly wh: Webhook | null;

  constructor(
    config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = config.email.RESEND_WEBHOOK_SECRET;
    this.wh = secret ? new Webhook(secret) : null;
  }

  @Post('resend')
  @Public()
  @SkipResponseWrap()
  @HttpCode(HttpStatus.OK)
  async handleResendWebhook(
    @RawBody() rawBody: Buffer | undefined,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: true }> {
    if (!rawBody || rawBody.length === 0) {
      this.logger.warn('Resend webhook received with empty body — ignoring');
      return { received: true };
    }

    const body = rawBody.toString();

    if (this.wh) {
      try {
        this.wh.verify(body, {
          'svix-id': headers['svix-id'],
          'svix-timestamp': headers['svix-timestamp'],
          'svix-signature': headers['svix-signature'],
        });
      } catch {
        throw new ForbiddenException('Invalid webhook signature');
      }
    }

    let event: {
      type?: string;
      data?: { email_id?: string; bounce?: { message?: string } };
    };
    try {
      event = JSON.parse(body);
    } catch {
      this.logger.warn('Resend webhook received with invalid JSON — ignoring');
      return { received: true };
    }

    const { type, data } = event;

    if (!data?.email_id) {
      this.logger.warn(
        `Resend webhook '${type ?? 'unknown'}' has no email_id — ignoring`,
      );
      return { received: true };
    }

    const emailLog = await this.prisma.baseClient.emailLog.findUnique({
      where: { resendId: data.email_id },
    });

    if (!emailLog) {
      this.logger.warn(`No email log found for resend_id: ${data.email_id}`);
      return { received: true };
    }

    const updateData: Record<string, unknown> = {
      webhookEvents: [...((emailLog.webhookEvents as any[]) ?? []), event],
    };

    switch (type) {
      case WEBHOOK_EVENT_TYPE.DELIVERED:
        updateData.status = EMAIL_STATUS.DELIVERED;
        updateData.deliveredAt = new Date();
        break;
      case WEBHOOK_EVENT_TYPE.BOUNCED:
        updateData.status = EMAIL_STATUS.BOUNCED;
        updateData.bouncedAt = new Date();
        updateData.errorMessage = data.bounce?.message;
        break;
      case WEBHOOK_EVENT_TYPE.COMPLAINED:
        updateData.status = EMAIL_STATUS.COMPLAINED;
        updateData.complainedAt = new Date();
        break;
      case WEBHOOK_EVENT_TYPE.SENT:
        if (emailLog.status === EMAIL_STATUS.PENDING) {
          updateData.status = EMAIL_STATUS.SENT;
          updateData.sentAt = new Date();
        }
        break;
      default:
        this.logger.debug(`Unhandled webhook event type: ${type}`);
    }

    await this.prisma.baseClient.emailLog.update({
      where: { id: emailLog.id },
      data: updateData,
    });

    return { received: true };
  }
}
