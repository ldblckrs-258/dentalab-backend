import {
  IsISO8601,
  IsInt,
  IsUUID,
  IsOptional,
  Min,
  Max,
} from 'class-validator';

export class RescheduleAppointmentDto {
  @IsISO8601()
  startTime: string;

  @IsInt()
  @Min(5)
  @Max(480)
  @IsOptional()
  durationMinutes?: number;

  @IsUUID()
  @IsOptional()
  providerId?: string;

  @IsUUID()
  @IsOptional()
  operatoryId?: string;
}
