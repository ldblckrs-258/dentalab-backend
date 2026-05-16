import {
  ValidateIf,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}
