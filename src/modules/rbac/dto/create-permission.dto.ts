import { IsString, MinLength, IsOptional } from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  @MinLength(1)
  resource: string;

  @IsString()
  @MinLength(1)
  action: string;

  @IsOptional()
  @IsString()
  description?: string;
}
