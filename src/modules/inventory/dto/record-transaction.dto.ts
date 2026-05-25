import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import {
  INVENTORY_ADJUST_SUB_TYPES,
  INVENTORY_REFERENCE_TYPES,
  INVENTORY_TX_TYPES,
  type InventoryAdjustSubType,
  type InventoryReferenceType,
  type InventoryTxType,
} from '../inventory.types';

/**
 * Cross-field rule attached to `type` (always present, so always runs):
 *   - if type === 'adjustment' → subType must be defined
 *   - if type !== 'adjustment' → subType must be undefined
 */
function SubTypeMatchesType(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'subTypeMatchesType',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args?: ValidationArguments) {
          const obj = (args?.object ?? {}) as RecordTransactionDto;
          if (obj.type === 'adjustment') return obj.subType !== undefined;
          return obj.subType === undefined;
        },
        defaultMessage(args?: ValidationArguments) {
          const obj = (args?.object ?? {}) as RecordTransactionDto;
          if (obj.type === 'adjustment')
            return 'subType is required when type is "adjustment"';
          return 'subType is only allowed when type is "adjustment"';
        },
      },
    });
  };
}

export class RecordTransactionDto {
  @IsIn(INVENTORY_TX_TYPES as unknown as string[])
  @SubTypeMatchesType()
  type!: InventoryTxType;

  @IsOptional()
  @IsIn(INVENTORY_ADJUST_SUB_TYPES as unknown as string[])
  subType?: InventoryAdjustSubType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @IsOptional()
  @IsIn(INVENTORY_REFERENCE_TYPES as unknown as string[])
  referenceType?: InventoryReferenceType;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
