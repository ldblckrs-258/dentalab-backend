import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailConsumerService } from './email-consumer.service';
import { EmailController } from './email.controller';
import { EmailWebhookController } from './email-webhook.controller';
import { TemplateService } from './template/template.service';
import { ResendProvider } from './providers/resend.provider';
import { EMAIL_PROVIDER } from './email.constants';

@Global()
@Module({
  controllers: [EmailController, EmailWebhookController],
  providers: [
    EmailService,
    EmailConsumerService,
    TemplateService,
    ResendProvider,
    {
      provide: EMAIL_PROVIDER,
      useExisting: ResendProvider,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
