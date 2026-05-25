import { forwardRef, Global, Module } from '@nestjs/common';
import { UserModule } from '@modules/user';
import { EmailService } from './email.service';
import { EmailConsumerService } from './email-consumer.service';
import { LowStockEmailConsumer } from './consumers/low-stock-email.consumer';
import { EmailController } from './email.controller';
import { EmailWebhookController } from './email-webhook.controller';
import { TemplateService } from './template/template.service';
import { ResendProvider } from './providers/resend.provider';
import { EMAIL_PROVIDER } from './email.constants';

@Global()
@Module({
  imports: [forwardRef(() => UserModule)],
  controllers: [EmailController, EmailWebhookController],
  providers: [
    EmailService,
    EmailConsumerService,
    LowStockEmailConsumer,
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
