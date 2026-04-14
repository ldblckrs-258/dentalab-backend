import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '@common/constants';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES)
  preferredLanguage?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  removeAvatar?: boolean;
}
