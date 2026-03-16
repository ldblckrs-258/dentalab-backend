import { IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @IsBoolean()
  is_active: boolean;
}
