import { IsBoolean } from 'class-validator';

export class UpdateProviderStatusDto {
  @IsBoolean()
  isActive: boolean;
}
