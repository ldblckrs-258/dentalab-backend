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

export class CreateProviderDto {
  @IsString()
  @Length(1, 64)
  name!: string;

  @IsIn(PROVIDER_KINDS)
  provider!: ProviderKind;

  @IsString()
  @Length(8, 512)
  @Matches(/^[\x21-\x7e]+$/, {
    message: 'apiKey must contain only printable ASCII, no whitespace',
  })
  apiKey!: string;

  @IsOptional()
  @Validate(IsSafeBaseUrlConstraint)
  baseUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
