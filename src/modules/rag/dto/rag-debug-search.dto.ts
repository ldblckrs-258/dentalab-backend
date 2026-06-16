import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ALLOWED_SOURCE_TYPES = ['internal_document', 'clinical_note'] as const;
type DebugSourceType = (typeof ALLOWED_SOURCE_TYPES)[number];

export class RagDebugSearchDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(2000)
  query!: string;

  @IsUUID('4')
  userId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(64)
  rerankPoolMultiplier?: number;

  @IsOptional()
  @IsInt()
  @Min(32)
  @Max(4096)
  rerankMaxLength?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(120000)
  rerankTimeoutMs?: number;

  @IsOptional()
  @IsBoolean()
  skipRerank?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(ALLOWED_SOURCE_TYPES, { each: true })
  sourceTypes?: DebugSourceType[];
}
