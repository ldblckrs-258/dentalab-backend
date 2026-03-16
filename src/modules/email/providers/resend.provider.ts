import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { AppConfigService } from '@modules/config';
import type {
  EmailProvider,
  SendEmailOptions,
  SendEmailResult,
  SendBatchResult,
} from './email-provider.interface';

@Injectable()
export class ResendProvider implements EmailProvider {
  private readonly resend: Resend;
  private readonly logger = new Logger(ResendProvider.name);

  constructor(private readonly config: AppConfigService) {
    this.resend = new Resend(config.email.RESEND_API_KEY);
  }

  private get defaultFrom(): string {
    return `${this.config.email.EMAIL_FROM_NAME} <${this.config.email.EMAIL_FROM_ADDRESS}>`;
  }

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const { data, error } = await this.resend.emails.send(
      {
        from: options.from ?? this.defaultFrom,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
        replyTo: options.replyTo ? [options.replyTo] : undefined,
        attachments: options.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
        tags: options.tags,
      },
      options.idempotencyKey
        ? { idempotencyKey: options.idempotencyKey }
        : undefined,
    );

    if (error) {
      this.logger.error(`Resend send failed: ${error.message}`);
      throw new Error(`Email send failed: ${error.message}`);
    }

    return { id: data.id };
  }

  async sendBatch(options: SendEmailOptions[]): Promise<SendBatchResult> {
    const { data, error } = await this.resend.batch.send(
      options.map((opt) => ({
        from: opt.from ?? this.defaultFrom,
        to: Array.isArray(opt.to) ? opt.to : [opt.to],
        subject: opt.subject,
        html: opt.html,
        tags: opt.tags,
      })),
    );

    if (error) {
      this.logger.error(`Resend batch failed: ${error.message}`);
      throw new Error(`Batch send failed: ${error.message}`);
    }

    return {
      results: data.data.map((d) => ({ id: d.id })),
    };
  }
}
