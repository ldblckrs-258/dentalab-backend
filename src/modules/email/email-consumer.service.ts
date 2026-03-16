import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  private async handleResetPassword(
    payload: EmailSendResetPasswordPayload,
    messageId: string,
  ): Promise<void> {
    const resetLink = `${this.config.email.FRONTEND_URL}/reset-password?token=${payload.resetToken}`;

    await this.emailService.sendTemplatedEmail({
      to: payload.email,
      templateName: SYSTEM_TEMPLATES.PASSWORD_RESET,
      variables: {
        userName: payload.email.split('@')[0],
        resetLink,
        expiresIn: '1 hour',
      },
      entityType: 'user',
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

    await this.emailService.sendTemplatedEmail({
      to: payload.email,
      templateName: SYSTEM_TEMPLATES.WELCOME,
      variables: {
        userName: payload.fullName,
        email: payload.email,
        temporaryPassword: payload.temporaryPassword,
        loginLink,
      },
      entityType: 'user',
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
