import { Injectable, Logger } from '@nestjs/common';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import type { LowStockEventPayload } from './inventory.types';

@Injectable()
export class LowStockPublisher {
  private readonly logger = new Logger(LowStockPublisher.name);

  constructor(private readonly queueProducer: QueueProducerService) {}

  publish(payload: LowStockEventPayload): boolean {
    try {
      return this.queueProducer.publish(
        ROUTING_KEY.INVENTORY_LOW_STOCK,
        payload,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish low-stock event for ${payload.itemId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
