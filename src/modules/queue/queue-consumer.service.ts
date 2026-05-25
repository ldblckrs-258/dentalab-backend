import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import type { QueueMessage } from './interfaces/queue-message.interface';
import {
  EXCHANGE_EVENTS,
  MAX_RETRY_COUNT,
  RABBITMQ_CHANNEL,
} from './queue.constants';

@Injectable()
export class QueueConsumerService {
  private readonly logger = new Logger(QueueConsumerService.name);

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channel: Channel | null,
  ) {}

  async consume(
    queue: string,
    handler: (message: QueueMessage) => Promise<void> | void,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn(
        `Cannot consume from ${queue}: RabbitMQ channel unavailable`,
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    await this.channel.consume(queue, async (msg: ConsumeMessage | null) => {
      if (!msg || !this.channel) return;

      try {
        const content: QueueMessage = JSON.parse(msg.content.toString());
        await handler(content);
        this.safeAck(msg);
      } catch (error) {
        const retryCount =
          (msg.properties.headers?.['x-retry-count'] as number) ?? 0;

        if (retryCount < MAX_RETRY_COUNT) {
          this.logger.warn(
            `Message failed (retry ${retryCount + 1}/${MAX_RETRY_COUNT}): ${(error as Error).message}`,
          );
          // Republish with incremented retry count
          this.safeAck(msg);
          this.safePublish(msg.fields.routingKey, msg.content, {
            ...msg.properties,
            headers: {
              ...msg.properties.headers,
              'x-retry-count': retryCount + 1,
              'x-last-error': (error as Error).message,
            },
          });
        } else {
          this.logger.error(
            `Message exhausted retries, routing to DLQ: ${(error as Error).message}`,
          );
          // nack without requeue → goes to DLQ via dead-letter-exchange
          this.safeNack(msg);
        }
      }
    });

    this.logger.log(`Consuming from queue: ${queue}`);
  }

  /**
   * Best-effort ack/nack/publish. Swallows `IllegalOperationError` thrown
   * when the channel has been closed (e.g. during app shutdown) so a stray
   * in-flight message does not crash the consumer process or fail tests.
   */
  private safeAck(msg: ConsumeMessage): void {
    try {
      this.channel?.ack(msg);
    } catch (error) {
      const message = (error as Error).message;
      if (
        !message.includes('Channel closed') &&
        !message.includes('Channel closing')
      ) {
        this.logger.warn(`ack failed: ${message}`);
      }
    }
  }

  private safeNack(msg: ConsumeMessage): void {
    try {
      this.channel?.nack(msg, false, false);
    } catch (error) {
      const message = (error as Error).message;
      if (
        !message.includes('Channel closed') &&
        !message.includes('Channel closing')
      ) {
        this.logger.warn(`nack failed: ${message}`);
      }
    }
  }

  private safePublish(
    routingKey: string,
    content: Buffer,
    options: import('amqplib').Options.Publish,
  ): void {
    try {
      this.channel?.publish(EXCHANGE_EVENTS, routingKey, content, options);
    } catch (error) {
      const message = (error as Error).message;
      if (
        !message.includes('Channel closed') &&
        !message.includes('Channel closing')
      ) {
        this.logger.warn(`publish failed: ${message}`);
      }
    }
  }
}
