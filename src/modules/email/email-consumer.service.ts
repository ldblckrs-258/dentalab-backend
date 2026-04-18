import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/vi';
import { AppConfigService } from '@modules/config';
import { QueueConsumerService } from '@modules/queue';
import { QUEUE_EMAIL_SEND, ROUTING_KEY } from '@modules/queue/queue.constants';
import type {
  QueueMessage,
  EmailSendResetPasswordPayload,
  EmailSendWelcomePayload,
  EmailSendReminderPayload,
} from '@modules/queue/interfaces';
import { EmailService } from './email.service';
import { SYSTEM_TEMPLATES } from './email.constants';

dayjs.extend(duration);
dayjs.extend(relativeTime);

@Injectable()
export class EmailConsumerService implements OnModuleInit {
  private readonly logger = new Logger(EmailConsumerService.name);

  constructor(
    private readonly queueConsumer: QueueConsumerService,
    private readonly emailService: EmailService,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit() {
    await this.queueConsumer.consume(QUEUE_EMAIL_SEND, (message) =>
      this.handleMessage(message),
    );
  }

  private async handleMessage(message: QueueMessage): Promise<void> {
    switch (message.routingKey) {
      case ROUTING_KEY.EMAIL_SEND_RESET_PASSWORD:
        return this.handleResetPassword(
          message.payload as EmailSendResetPasswordPayload,
          message.messageId,
        );
      case ROUTING_KEY.EMAIL_SEND_WELCOME:
        return this.handleWelcome(
          message.payload as EmailSendWelcomePayload,
          message.messageId,
        );
      case ROUTING_KEY.EMAIL_SEND_REMINDER:
        return this.handleReminder(
          message.payload as EmailSendReminderPayload,
          message.messageId,
        );
      default:
        this.logger.warn(`Unknown email routing key: ${message.routingKey}`);
    }
  }

  private brandingVars() {
    return {
      logoUrl: `${this.config.email.FRONTEND_URL}/dentalab.png`,
      year: new Date().getFullYear(),
    };
  }

  private formatDuration(expiresAt: string): string {
    const diffMs = Math.max(60_000, new Date(expiresAt).getTime() - Date.now());
    return dayjs.duration(diffMs).locale('vi').humanize();
  }

  private async handleResetPassword(
    payload: EmailSendResetPasswordPayload,
    messageId: string,
  ): Promise<void> {
    const userName = payload.email.split('@')[0];
    const resetLink = `${this.config.email.FRONTEND_URL}/reset-password?token=${payload.resetToken}`;
    const expiresIn = this.formatDuration(payload.expiresAt);

    await this.emailService.sendTemplatedEmail({
      to: payload.email,
      templateName: SYSTEM_TEMPLATES.PASSWORD_RESET,
      variables: {
        userName,
        resetLink,
        expiresIn,
        ...this.brandingVars(),
      },
      entityType: 'password_reset',
      entityId: payload.userId,
      tags: [{ name: 'category', value: 'auth' }],
      idempotencyKey: `reset-password/${messageId}`,
    });
  }

  private async handleWelcome(
    payload: EmailSendWelcomePayload,
    messageId: string,
  ): Promise<void> {
    const loginLink = `${this.config.email.FRONTEND_URL}/login`;
    const userName = payload.fullName;

    await this.emailService.sendTemplatedEmail({
      to: payload.email,
      templateName: SYSTEM_TEMPLATES.WELCOME,
      variables: {
        userName,
        email: payload.email,
        temporaryPassword: payload.temporaryPassword,
        loginLink,
        ...this.brandingVars(),
      },
      entityType: 'system',
      entityId: payload.userId,
      tags: [{ name: 'category', value: 'auth' }],
      idempotencyKey: `welcome/${messageId}`,
    });
  }

  private async handleReminder(
    payload: EmailSendReminderPayload,
    messageId: string,
  ): Promise<void> {
    await this.emailService.sendTemplatedEmail({
      to: payload.patientEmail,
      templateName: SYSTEM_TEMPLATES.REMINDER,
      variables: payload.variables,
      entityType: 'appointment',
      entityId: payload.appointmentId,
      tags: [{ name: 'category', value: 'reminder' }],
      idempotencyKey: `reminder/${messageId}`,
    });
  }
}
