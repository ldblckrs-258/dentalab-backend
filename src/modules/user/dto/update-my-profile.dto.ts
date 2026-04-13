import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '@common/constants';

export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  full_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES)
  preferred_language?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  remove_avatar?: boolean;
}
