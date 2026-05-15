import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsUUID,
} from 'class-validator';

export class BatchAvailabilityQueryDto {
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',').filter(Boolean)
        : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  providerIds: string[];

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
