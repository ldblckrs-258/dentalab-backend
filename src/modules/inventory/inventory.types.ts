export const INVENTORY_TX_TYPES = [
  'purchase',
  'return',
  'usage',
  'adjustment',
  'damage',
] as const;
export type InventoryTxType = (typeof INVENTORY_TX_TYPES)[number];

export const INVENTORY_ADJUST_SUB_TYPES = ['increase', 'decrease'] as const;
export type InventoryAdjustSubType =
  (typeof INVENTORY_ADJUST_SUB_TYPES)[number];

export const INVENTORY_REFERENCE_TYPES = [
  'appointment',
  'patient_procedure',
] as const;
export type InventoryReferenceType = (typeof INVENTORY_REFERENCE_TYPES)[number];

export type { InventoryLowStockPayload as LowStockEventPayload } from '@modules/queue/interfaces';

export function signedDelta(
  type: InventoryTxType,
  subType: InventoryAdjustSubType | undefined,
  quantity: number,
): number {
  switch (type) {
    case 'purchase':
    case 'return':
      return quantity;
    case 'usage':
    case 'damage':
      return -quantity;
    case 'adjustment':
      return subType === 'decrease' ? -quantity : quantity;
  }
}
