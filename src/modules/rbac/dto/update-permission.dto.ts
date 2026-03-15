import { IsString, IsOptional } from 'class-validator';

export class UpdatePermissionDto {
  @IsOptional()
  @IsString()
  description?: string;
}
