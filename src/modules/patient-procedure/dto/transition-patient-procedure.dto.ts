import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import type { PatientProcedureStatus } from '../constants/patient-procedure-transitions';

export class TransitionPatientProcedureDto {
  @IsIn([
    'planned',
    'scheduled',
    'in_progress',
    'completed',
    'cancelled',
    'failed',
  ])
  to: PatientProcedureStatus;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @IsUUID()
  performedByProviderId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  actualFee?: number;

  @IsOptional()
  @IsString()
  cancellationReason?: string;
}
