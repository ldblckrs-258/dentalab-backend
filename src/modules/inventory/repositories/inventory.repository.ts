import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface StockChangeResult {
  quantityBefore: number;
  quantityAfter: number;
  minQuantity: number;
  name: string;
  sku: string;
}

@Injectable()
export class InventoryRepository {
  /**
   * Atomic stock update. Returns `null` when 0 rows affected.
   * Caller disambiguates not-found vs archived vs insufficient stock.
   */
  async applyStockChange(
    tx: Prisma.TransactionClient,
    args: { itemId: string; delta: number },
  ): Promise<StockChangeResult | null> {
    const rows = await tx.$queryRaw<
      Array<{
        quantity_before: number;
        quantity_after: number;
        min_quantity: number;
        name: string;
        sku: string;
      }>
    >`
      UPDATE inventory_items
      SET quantity = quantity + ${args.delta}, updated_at = NOW()
      WHERE id = ${args.itemId}::uuid
        AND is_active = true
        AND quantity + ${args.delta} >= 0
      RETURNING (quantity - ${args.delta}) AS quantity_before,
                quantity AS quantity_after,
                min_quantity,
                name,
                sku
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      quantityBefore: r.quantity_before,
      quantityAfter: r.quantity_after,
      minQuantity: r.min_quantity,
      name: r.name,
      sku: r.sku,
    };
  }
}
