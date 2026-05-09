import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
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
  @IsString()
  notes?: string;
}
