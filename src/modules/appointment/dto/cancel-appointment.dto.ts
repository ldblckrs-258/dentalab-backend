import { IsString, MaxLength } from 'class-validator';

export class CancelAppointmentDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}
