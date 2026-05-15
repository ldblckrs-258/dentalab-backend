import { Transform, Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListAppointmentsQueryDto {
  @IsISO8601()
  from: string;

  @IsISO8601()
  to: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string')
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    if (Array.isArray(value)) return value;
    return undefined;
  })
  @IsUUID('all', { each: true })
  providerIds?: string[];

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string')
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    if (Array.isArray(value)) return value;
    return undefined;
  })
  @IsString({ each: true })
  statuses?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 200;
}
