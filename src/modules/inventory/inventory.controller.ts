import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AuditMutation,
  CurrentUser,
  RequirePermissions,
} from '@common/decorators';
import { t } from '@common/utils';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { ListItemsQueryDto } from './dto/list-items-query.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { RecordTransactionDto } from './dto/record-transaction.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ─── Items ───────────────────────────────────────────────────

  @Get('items')
  @RequirePermissions('inventory_items:read')
  list(@Query() query: ListItemsQueryDto) {
    return this.inventoryService.listItems(query);
  }

  @Get('items/categories')
  @RequirePermissions('inventory_items:read')
  listCategories() {
    return this.inventoryService.listCategories();
  }

  @Post('items')
  @RequirePermissions('inventory_items:create')
  @AuditMutation({
    code: 'INVENTORY_ITEM_CREATED',
    resource: 'inventory_item',
  })
  create(@Body() dto: CreateInventoryItemDto) {
    return this.inventoryService.createItem(dto);
  }

  @Post('items/import')
  @RequirePermissions('inventory_items:create', 'inventory_items:update')
  @AuditMutation({
    code: 'INVENTORY_ITEM_CREATED',
    resource: 'inventory_item',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }),
  )
  async importCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        t('inventory.import.file_required', 'CSV file is required'),
      );
    }
    if (!/csv|text\/plain|application\/vnd\.ms-excel/.test(file.mimetype)) {
      throw new BadRequestException(
        t('inventory.import.invalid_mime', 'File must be a CSV (text/csv)'),
      );
    }
    return this.inventoryService.importFromCsv(file, userId);
  }

  @Get('items/:id')
  @RequirePermissions('inventory_items:read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.getItem(id);
  }

  @Patch('items/:id')
  @RequirePermissions('inventory_items:update')
  @AuditMutation({
    code: 'INVENTORY_ITEM_UPDATED',
    resource: 'inventory_item',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.inventoryService.updateItem(id, dto);
  }

  @Delete('items/:id')
  @RequirePermissions('inventory_items:delete')
  @AuditMutation({
    code: 'INVENTORY_ITEM_UPDATED',
    resource: 'inventory_item',
  })
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.archiveItem(id);
  }

  @Post('items/:id/restore')
  @RequirePermissions('inventory_items:update')
  @AuditMutation({
    code: 'INVENTORY_ITEM_UPDATED',
    resource: 'inventory_item',
  })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.restoreItem(id);
  }

  // ─── Transactions ────────────────────────────────────────────

  @Get('items/:id/transactions')
  @RequirePermissions('inventory_items:read')
  listTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.inventoryService.listTransactions(id, query);
  }

  @Post('items/:id/transactions')
  @RequirePermissions('inventory_items:update')
  @AuditMutation({
    code: 'INVENTORY_TRANSACTION_RECORDED',
    resource: 'inventory_transaction',
  })
  recordTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordTransactionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventoryService.recordTransaction(id, dto, userId);
  }
}
