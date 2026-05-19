import { IsBooleanString, IsIn, IsOptional } from 'class-validator';
import type { ModelRole } from '../types';

const MODEL_ROLES = ['answer', 'rewrite'] as const;

export class ListModelsQueryDto {
  @IsOptional()
  @IsIn(MODEL_ROLES)
  role?: ModelRole;

  @IsOptional()
  @IsBooleanString()
  active?: string;
}
