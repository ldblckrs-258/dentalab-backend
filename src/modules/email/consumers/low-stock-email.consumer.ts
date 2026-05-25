import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  QueueConsumerService,
  QueueProducerService,
  ROUTING_KEY,
} from '@modules/queue';
import { QUEUE_NOTIFICATION_INVENTORY } from '@modules/queue/queue.constants';
import type {
  InventoryLowStockPayload,
  QueueMessage,
} from '@modules/queue/interfaces';
import { CacheService } from '@modules/redis';
import { UserService } from '@modules/user';
import { SYSTEM_ROLE_CODE } from '@common/constants';

const DEDUP_DOMAIN = 'inventory:low_stock';
const DEDUP_TTL_SECONDS = 86_400; // 24 hours

@Injectable()
export class LowStockEmailConsumer implements OnModuleInit {
  private readonly logger = new Logger(LowStockEmailConsumer.name);

  constructor(
    private readonly queueConsumer: QueueConsumerService,
    private readonly queueProducer: QueueProducerService,
    private readonly userService: UserService,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queueConsumer.consume(QUEUE_NOTIFICATION_INVENTORY, (message) =>
      this.handleMessage(message),
    );
  }

  private async handleMessage(message: QueueMessage): Promise<void> {
    const payload = message.payload as InventoryLowStockPayload;
    if (!payload?.itemId) {
      this.logger.warn(
        `Invalid low-stock payload (missing itemId), skipping: ${message.messageId}`,
      );
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const acquired = await this.cache.setWithNX(
      DEDUP_DOMAIN,
      `${payload.itemId}:${today}`,
      '1',
      DEDUP_TTL_SECONDS,
    );
    if (!acquired) {
      this.logger.debug(
        `Low-stock dedup hit for ${payload.itemId} on ${today}, skipping`,
      );
      return;
    }

    const recipients = await this.userService.findByRoleCodes([
      SYSTEM_ROLE_CODE.ADMIN,
      SYSTEM_ROLE_CODE.MANAGER,
    ]);
    if (recipients.length === 0) {
      this.logger.warn(
        `No active Admin/Manager recipients for low-stock item ${payload.itemId}`,
      );
      return;
    }

    for (const recipient of recipients) {
      this.queueProducer.publish(ROUTING_KEY.EMAIL_SEND_LOW_STOCK, {
        to: recipient.email,
        name: recipient.fullName,
        lang: recipient.preferredLanguage,
        item: payload,
      });
    }
  }
}
