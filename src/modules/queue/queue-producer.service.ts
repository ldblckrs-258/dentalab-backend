import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Channel } from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { RABBITMQ_CHANNEL, EXCHANGE_EVENTS } from './queue.constants';
import type { EventPayload } from './interfaces/event-payloads.interface';
import type {
  QueueMessage,
  PublishOptions,
} from './interfaces/queue-message.interface';

@Injectable()
export class QueueProducerService {
  private readonly logger = new Logger(QueueProducerService.name);

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel | null,
  ) {}

  publish(
    routingKey: string,
    payload: EventPayload,
    options?: PublishOptions,
  ): void {
    if (!this.channel) {
      this.logger.warn(
        `Cannot publish to ${routingKey}: RabbitMQ channel unavailable`,
      );
      return;
    }

    const message: QueueMessage = {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: options?.correlationId,
      routingKey,
      payload,
    };

    try {
      this.channel.publish(
        EXCHANGE_EVENTS,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          messageId: message.messageId,
          timestamp: Date.now(),
          contentType: 'application/json',
          headers: {
            'x-retry-count': 0,
          },
        },
      );
      this.logger.debug(
        `Published message to ${routingKey}: ${message.messageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish to ${routingKey}: ${(error as Error).message}`,
      );
    }
  }
}
