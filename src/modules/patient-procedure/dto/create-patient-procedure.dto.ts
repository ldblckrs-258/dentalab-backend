import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import {
  FDI_TOOTH_REGEX,
  TOOTH_SURFACE_REGEX,
} from '../constants/patient-procedure-validators';

export class CreatePatientProcedureDto {
  @IsUUID()
  patientId: string;

  @IsUUID()
  procedureId: string;

  @IsOptional()
  @IsUUID()
  treatmentPlanId?: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @IsUUID()
  plannedProviderId?: string;

  @IsOptional()
  @IsString()
  @Matches(FDI_TOOTH_REGEX, {
    message: 'toothNumber must be a valid FDI tooth number',
  })
  toothNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(TOOTH_SURFACE_REGEX, {
    message: 'surface must contain only valid surface codes (M, O, D, B, L, I)',
  })
  surface?: string;

  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsString()
  clinicalNotes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedFee?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sequenceInPlan?: number;
}
