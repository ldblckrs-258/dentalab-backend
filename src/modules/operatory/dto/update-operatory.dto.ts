import {
  IsBoolean,
  IsHexColor,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateOperatoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
