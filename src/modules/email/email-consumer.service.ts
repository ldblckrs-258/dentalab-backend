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
  EmailSendLowStockPayload,
  AppointmentEmailPayload,
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
      case ROUTING_KEY.EMAIL_SEND_LOW_STOCK:
        return this.handleLowStock(
          message.payload as EmailSendLowStockPayload,
          message.messageId,
        );
      case ROUTING_KEY.EMAIL_SEND_APPT_CREATED:
        return this.handleAppointmentEmail(
          message.payload as AppointmentEmailPayload,
          SYSTEM_TEMPLATES.APPT_CREATED,
        );
      case ROUTING_KEY.EMAIL_SEND_APPT_CONFIRMED:
        return this.handleAppointmentEmail(
          message.payload as AppointmentEmailPayload,
          SYSTEM_TEMPLATES.APPT_CONFIRMED,
        );
      case ROUTING_KEY.EMAIL_SEND_APPT_COMPLETED:
        return this.handleAppointmentEmail(
          message.payload as AppointmentEmailPayload,
          SYSTEM_TEMPLATES.APPT_COMPLETED,
        );
      case ROUTING_KEY.EMAIL_SEND_APPT_CANCELLED:
        return this.handleAppointmentEmail(
          message.payload as AppointmentEmailPayload,
          SYSTEM_TEMPLATES.APPT_CANCELLED,
        );
      case ROUTING_KEY.EMAIL_SEND_REMINDER:
        return this.handleAppointmentEmail(
          message.payload as AppointmentEmailPayload,
          SYSTEM_TEMPLATES.REMINDER,
        );
      default:
        this.logger.warn(`Unknown email routing key: ${message.routingKey}`);
    }
  }

  private async handleAppointmentEmail(
    payload: AppointmentEmailPayload,
    templateName: string,
  ): Promise<void> {
    await this.emailService.sendTemplatedEmail({
      to: payload.to,
      templateName,
      lang: payload.lang ?? 'vi',
      variables: {
        ...payload.variables,
        isUser: payload.recipientRole === 'provider',
        ...this.brandingVars(),
      },
      entityType: 'appointment',
      entityId: payload.appointmentId,
      tags: [{ name: 'category', value: 'appointment' }],
      idempotencyKey: `${templateName}/${payload.appointmentId}/${payload.recipientRole}`,
    });
  }

  private async handleLowStock(
    payload: EmailSendLowStockPayload,
    messageId: string,
  ): Promise<void> {
    const dashboardUrl = `${this.config.email.FRONTEND_URL}/inventory/${payload.item.itemId}`;
    await this.emailService.sendTemplatedEmail({
      to: payload.to,
      templateName: SYSTEM_TEMPLATES.LOW_STOCK_ALERT,
      lang: payload.lang ?? 'vi',
      variables: {
        name: payload.name,
        item: payload.item,
        dashboardUrl,
        ...this.brandingVars(),
      },
      entityType: 'system',
      entityId: payload.item.itemId,
      tags: [{ name: 'category', value: 'inventory' }],
      idempotencyKey: `low-stock/${messageId}`,
    });
  }

  private brandingVars() {
    return {
      logoUrl: `${this.config.email.FRONTEND_URL}/dentalab.png`,
      year: new Date().getFullYear(),
    };
  }

  private formatDuration(expiresAt: string, lang: string): string {
    const diffMs = Math.max(60_000, new Date(expiresAt).getTime() - Date.now());
    return dayjs.duration(diffMs).locale(lang).humanize();
  }

  private async handleResetPassword(
    payload: EmailSendResetPasswordPayload,
    messageId: string,
  ): Promise<void> {
    const lang = payload.lang ?? 'vi';
    const userName = payload.email.split('@')[0];
    const resetLink = `${this.config.email.FRONTEND_URL}/reset-password?token=${payload.resetToken}`;
    const expiresIn = this.formatDuration(payload.expiresAt, lang);

    await this.emailService.sendTemplatedEmail({
      to: payload.email,
      templateName: SYSTEM_TEMPLATES.PASSWORD_RESET,
      lang: payload.lang ?? 'vi',
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
      lang: payload.lang ?? 'vi',
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
}
