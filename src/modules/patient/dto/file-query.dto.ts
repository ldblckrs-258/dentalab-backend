import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@modules/pagination';
import { FILE_CATEGORIES, type FileCategory } from './upload-file.dto';

export class FileQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(FILE_CATEGORIES)
  category?: FileCategory;
}
