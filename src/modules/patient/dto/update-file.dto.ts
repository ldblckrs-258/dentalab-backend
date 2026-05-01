import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FILE_CATEGORIES, type FileCategory } from './upload-file.dto';

export class UpdateFileDto {
  @IsOptional()
  @IsString()
  @IsIn(FILE_CATEGORIES)
  category?: FileCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
