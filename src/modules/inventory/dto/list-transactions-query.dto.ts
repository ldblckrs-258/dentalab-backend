import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@modules/pagination';
import { INVENTORY_TX_TYPES, type InventoryTxType } from '../inventory.types';

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(INVENTORY_TX_TYPES as unknown as string[])
  type?: InventoryTxType;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
