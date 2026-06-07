import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class OperatoryAvailabilityQueryDto {
  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;

  @IsUUID()
  @IsOptional()
  excludeAppointmentId?: string;
}
