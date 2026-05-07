import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateProcedureDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  adaCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultFee?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
