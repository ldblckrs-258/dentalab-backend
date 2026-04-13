import { IsBoolean } from 'class-validator';

export class UpdateProviderStatusDto {
  @IsBoolean()
  is_active: boolean;
}
