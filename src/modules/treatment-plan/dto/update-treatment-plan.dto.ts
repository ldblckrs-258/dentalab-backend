import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateTreatmentPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  consentSignedBy?: string;
}
