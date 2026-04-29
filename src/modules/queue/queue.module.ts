import {
  Global,
  Inject,
  Module,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import type { Channel, ChannelModel } from 'amqplib';
import {
  rabbitmqConnectionProvider,
  rabbitmqChannelProvider,
} from './queue.provider';
import { QueueProducerService } from './queue-producer.service';
import { QueueConsumerService } from './queue-consumer.service';
import { RABBITMQ_CONNECTION, RABBITMQ_CHANNEL } from './queue.constants';

@Global()
@Module({
  providers: [
    rabbitmqConnectionProvider,
    rabbitmqChannelProvider,
    QueueProducerService,
    QueueConsumerService,
  ],
  exports: [
    QueueProducerService,
    QueueConsumerService,
    rabbitmqConnectionProvider,
    rabbitmqChannelProvider,
  ],
})
export class QueueModule implements OnModuleDestroy {
  private readonly logger = new Logger(QueueModule.name);

  constructor(
    @Inject(RABBITMQ_CONNECTION)
    private readonly connection: ChannelModel | null,
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
      this.logger.log('RabbitMQ disconnected');
    } catch (error) {
      this.logger.warn(`RabbitMQ cleanup error: ${(error as Error).message}`);
    }
  }
}
