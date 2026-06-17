import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDocumentsAccessPermissionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
