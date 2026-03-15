import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  QueueConsumerService,
  QUEUE_EMAIL_SEND,
  ROUTING_KEY,
} from '@modules/queue';
import type { EmailSendResetPasswordPayload } from '@modules/queue';

@Injectable()
export class EmailConsumerService implements OnModuleInit {
  private readonly logger = new Logger(EmailConsumerService.name);

  constructor(private readonly queueConsumer: QueueConsumerService) {}

  async onModuleInit() {
    await this.queueConsumer.consume(QUEUE_EMAIL_SEND, (message) => {
      if (message.routingKey === ROUTING_KEY.EMAIL_SEND_RESET_PASSWORD) {
        this.handleResetPasswordEmail(
          message.payload as EmailSendResetPasswordPayload,
        );
      }
    });
  }

  private handleResetPasswordEmail(
    payload: EmailSendResetPasswordPayload,
  ): void {
    // TODO: Replace with actual email sending (nodemailer/SES) in Email module
    this.logger.log(
      `Password reset email for ${payload.email} — token: ${payload.resetToken.substring(0, 8)}...`,
    );
  }
}
