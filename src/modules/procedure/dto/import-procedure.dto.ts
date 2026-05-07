import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ResolvedProcedureRowDto {
  @IsString()
  adaCode: string;

  @IsString()
  name: string;

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

  @IsBoolean()
  useNew: boolean;
}

export class ExecuteImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResolvedProcedureRowDto)
  rows: ResolvedProcedureRowDto[];
}
