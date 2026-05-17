import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateClinicalNoteDto {
  @IsUUID()
  patientId: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  subjective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  objective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  assessment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  plan?: string;
}
