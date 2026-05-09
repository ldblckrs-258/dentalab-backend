import { IsUUID } from 'class-validator';

export class LinkToAppointmentDto {
  @IsUUID()
  appointmentId: string;
}
