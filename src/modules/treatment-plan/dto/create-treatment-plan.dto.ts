import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTreatmentPlanDto {
  @IsUUID()
  patientId: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @ValidateIf((o: CreateTreatmentPlanDto) => !!o.startDate && !!o.endDate)
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedTotalCost?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
