import { Logger, Provider } from '@nestjs/common';
import * as amqplib from 'amqplib';
import { AppConfigService } from '@modules/config';
import {
  RABBITMQ_CONNECTION,
  RABBITMQ_CHANNEL,
  EXCHANGE_EVENTS,
  EXCHANGE_DLX,
  QUEUE_RAG_INDEXING,
  QUEUE_EMAIL_SEND,
  QUEUE_NOTIFICATION_INVENTORY,
  QUEUE_DLQ,
} from './queue.constants';

const logger = new Logger('QueueProvider');

async function setupTopology(channel: amqplib.Channel): Promise<void> {
  // Main topic exchange
  await channel.assertExchange(EXCHANGE_EVENTS, 'topic', { durable: true });

  // Dead letter exchange and queue
  await channel.assertExchange(EXCHANGE_DLX, 'fanout', { durable: true });
  await channel.assertQueue(QUEUE_DLQ, { durable: true });
  await channel.bindQueue(QUEUE_DLQ, EXCHANGE_DLX, '');

  // RAG indexing queue
  await channel.assertQueue(QUEUE_RAG_INDEXING, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EXCHANGE_DLX,
    },
  });
  await channel.bindQueue(QUEUE_RAG_INDEXING, EXCHANGE_EVENTS, 'document.#');
  await channel.bindQueue(
    QUEUE_RAG_INDEXING,
    EXCHANGE_EVENTS,
    'clinical_note.#',
  );

  // Email queue
  await channel.assertQueue(QUEUE_EMAIL_SEND, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EXCHANGE_DLX,
    },
  });
  await channel.bindQueue(QUEUE_EMAIL_SEND, EXCHANGE_EVENTS, 'email.#');

  // Inventory notification queue
  await channel.assertQueue(QUEUE_NOTIFICATION_INVENTORY, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EXCHANGE_DLX,
    },
  });
  await channel.bindQueue(
    QUEUE_NOTIFICATION_INVENTORY,
    EXCHANGE_EVENTS,
    'inventory.low_stock',
  );

  logger.log('RabbitMQ topology configured');
}

export const rabbitmqConnectionProvider: Provider = {
  provide: RABBITMQ_CONNECTION,
  useFactory: async (
    config: AppConfigService,
  ): Promise<amqplib.ChannelModel | null> => {
    try {
      const connection = await amqplib.connect(config.queue.RABBITMQ_URL);
      connection.on('error', (err) =>
        logger.error('RabbitMQ connection error', err.message),
      );
      connection.on('close', () => logger.warn('RabbitMQ connection closed'));
      logger.log('RabbitMQ connected');
      return connection;
    } catch (error) {
      logger.error(
        `RabbitMQ connection failed: ${(error as Error).message}. Starting in degraded mode.`,
      );
      return null;
    }
  },
  inject: [AppConfigService],
};

export const rabbitmqChannelProvider: Provider = {
  provide: RABBITMQ_CHANNEL,
  useFactory: async (
    connection: amqplib.ChannelModel | null,
    config: AppConfigService,
  ): Promise<amqplib.Channel | null> => {
    if (!connection) return null;
    try {
      const channel = await connection.createChannel();
      await channel.prefetch(config.queue.RABBITMQ_PREFETCH_COUNT);
      await setupTopology(channel);
      return channel;
    } catch (error) {
      logger.error(
        `RabbitMQ channel creation failed: ${(error as Error).message}`,
      );
      return null;
    }
  },
  inject: [RABBITMQ_CONNECTION, AppConfigService],
};
