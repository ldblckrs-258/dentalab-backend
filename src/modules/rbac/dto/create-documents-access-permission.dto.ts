import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateDocumentsAccessPermissionDto {
  @Matches(/^[a-z][a-z0-9_]{1,48}$/, {
    message:
      'scope must be a lowercase slug (a-z, 0-9, _) starting with a letter',
  })
  scope: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
