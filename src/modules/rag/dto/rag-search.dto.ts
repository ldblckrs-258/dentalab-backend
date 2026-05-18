import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ALLOWED_SOURCE_TYPES = ['internal_document'] as const;
export type RagSourceType = (typeof ALLOWED_SOURCE_TYPES)[number];

export class RagSearchDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(2000)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minScore?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(ALLOWED_SOURCE_TYPES, { each: true })
  sourceTypes?: RagSourceType[];
}
