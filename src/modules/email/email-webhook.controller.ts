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
    private readonly config: AppConfigService,
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
    @RawBody() rawBody: Buffer,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: true }> {
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

    const event = JSON.parse(body);
    const { type, data } = event;

    const emailLog = await this.prisma.baseClient.emailLog.findUnique({
      where: { resend_id: data.email_id },
    });

    if (!emailLog) {
      this.logger.warn(`No email log found for resend_id: ${data.email_id}`);
      return { received: true };
    }

    const updateData: Record<string, unknown> = {
      webhook_events: [...((emailLog.webhook_events as any[]) ?? []), event],
    };

    switch (type) {
      case WEBHOOK_EVENT_TYPE.DELIVERED:
        updateData.status = EMAIL_STATUS.DELIVERED;
        updateData.delivered_at = new Date();
        break;
      case WEBHOOK_EVENT_TYPE.BOUNCED:
        updateData.status = EMAIL_STATUS.BOUNCED;
        updateData.bounced_at = new Date();
        updateData.error_message = data.bounce?.message;
        break;
      case WEBHOOK_EVENT_TYPE.COMPLAINED:
        updateData.status = EMAIL_STATUS.COMPLAINED;
        updateData.complained_at = new Date();
        break;
      case WEBHOOK_EVENT_TYPE.SENT:
        if (emailLog.status === EMAIL_STATUS.PENDING) {
          updateData.status = EMAIL_STATUS.SENT;
          updateData.sent_at = new Date();
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
