import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
