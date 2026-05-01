import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const FILE_CATEGORIES = [
  'x_ray',
  'intraoral_photo',
  'document',
  'other',
] as const;

export type FileCategory = (typeof FILE_CATEGORIES)[number];

export class UploadFileDto {
  @IsString()
  @IsIn(FILE_CATEGORIES)
  category: FileCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
