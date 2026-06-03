import { IsUUID, ArrayMaxSize } from 'class-validator';

export class SetProviderAppointmentTypesDto {
  @IsUUID('all', { each: true })
  @ArrayMaxSize(50)
  typeIds: string[];
}
