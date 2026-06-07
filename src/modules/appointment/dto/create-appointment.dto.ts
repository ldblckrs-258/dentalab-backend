import {
  IsUUID,
  IsISO8601,
  IsInt,
  IsString,
  IsOptional,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  patientId: string;

  @IsUUID()
  providerId: string;

  @IsUUID()
  typeId: string;

  @IsUUID()
  operatoryId: string;

  @IsISO8601()
  startTime: string;

  @IsInt()
  @Min(5)
  @Max(480)
  @IsOptional()
  durationMinutes?: number;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  notes?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  chiefComplaint?: string;

  @IsUUID()
  @IsOptional()
  treatmentPlanId?: string;

  @IsUUID('all', { each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  procedureIds?: string[];
}
