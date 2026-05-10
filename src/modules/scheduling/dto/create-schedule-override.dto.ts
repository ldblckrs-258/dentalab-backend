import {
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateScheduleOverrideDto {
  @IsUUID()
  providerId: string;

  @IsDate()
  @Type(() => Date)
  specificDate: Date;

  @IsIn(['day_off', 'custom_hours'])
  overrideType: string;

  @ValidateIf((o) => o.overrideType === 'custom_hours')
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @ValidateIf((o) => o.overrideType === 'custom_hours')
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @IsOptional()
  @IsUUID()
  targetScheduleId?: string;

  @IsOptional()
  reason?: string;
}
