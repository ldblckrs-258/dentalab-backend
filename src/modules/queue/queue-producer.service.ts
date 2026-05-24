import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Channel } from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import {
  RABBITMQ_CHANNEL,
  EXCHANGE_EVENTS,
  ROUTING_KEY,
} from './queue.constants';
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
  ): boolean {
    return this.publishToExchange(
      EXCHANGE_EVENTS,
      routingKey,
      payload,
      options,
    );
  }

  publishDocumentUpdated(documentId: string): boolean {
    return this.publish(ROUTING_KEY.DOCUMENT_UPDATED, {
      sourceType: 'internal_document',
      sourceId: documentId,
      action: 'updated',
    });
  }

  publishToExchange(
    exchange: string,
    routingKey: string,
    payload: unknown,
    options?: PublishOptions,
  ): boolean {
    if (!this.channel) {
      this.logger.warn(
        `Cannot publish to ${exchange}/${routingKey}: RabbitMQ channel unavailable`,
      );
      return false;
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
        exchange,
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
        `Published message to ${exchange}/${routingKey}: ${message.messageId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to publish to ${exchange}/${routingKey}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
