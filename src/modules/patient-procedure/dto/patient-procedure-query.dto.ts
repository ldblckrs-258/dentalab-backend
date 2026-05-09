import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@modules/pagination';

export class PatientProcedureQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  treatmentPlanId?: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  scope?: string;
}
