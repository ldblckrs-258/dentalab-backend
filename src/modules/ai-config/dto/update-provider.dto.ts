import {
  IsString,
  IsIn,
  IsOptional,
  IsBoolean,
  Length,
  Matches,
  Validate,
} from 'class-validator';
import type { ProviderKind } from '../types';
import { IsSafeBaseUrlConstraint, PROVIDER_KINDS } from './validators';

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @IsOptional()
  @IsIn(PROVIDER_KINDS)
  provider?: ProviderKind;

  @IsOptional()
  @IsString()
  @Length(8, 512)
  @Matches(/^[\x21-\x7e]+$/, {
    message: 'apiKey must contain only printable ASCII, no whitespace',
  })
  apiKey?: string;

  @IsOptional()
  @Validate(IsSafeBaseUrlConstraint)
  baseUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
