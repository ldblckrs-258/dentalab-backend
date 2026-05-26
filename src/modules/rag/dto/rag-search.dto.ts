import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ALLOWED_SOURCE_TYPES = ['internal_document', 'clinical_note'] as const;
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

  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  ragDocumentIds?: string[];
}
