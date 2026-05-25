import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryRepository } from './repositories/inventory.repository';
import { LowStockPublisher } from './low-stock.publisher';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository, LowStockPublisher],
  exports: [InventoryService],
})
export class InventoryModule {}
