import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateKioskSessionDto {
  @IsUUID()
  patientId: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  formIds: string[];

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  expiresInMinutes?: number = 30;
}
