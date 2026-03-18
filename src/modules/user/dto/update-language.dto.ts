import { IsIn, IsString } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '@common/constants';

export class UpdateLanguageDto {
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES)
  language: string;
}
