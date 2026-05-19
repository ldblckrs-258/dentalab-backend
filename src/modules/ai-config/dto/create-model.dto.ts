import {
  IsString,
  IsUUID,
  IsIn,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  Max,
  Length,
} from 'class-validator';
import type { ModelRole } from '../types';

const MODEL_ROLES = ['answer', 'rewrite'] as const;

export class CreateModelDto {
  @IsUUID()
  providerId!: string;

  @IsIn(MODEL_ROLES)
  role!: ModelRole;

  @IsString()
  @Length(1, 128)
  modelName!: string;

  @IsString()
  @Length(1, 128)
  displayName!: string;

  @IsString()
  @Length(1, 8192)
  systemPrompt!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  topP?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32768)
  maxTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  ragTopK?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(64)
  historyWindow?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export { MODEL_ROLES };
