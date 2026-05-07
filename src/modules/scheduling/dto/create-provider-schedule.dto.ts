import {
  IsInt,
  IsUUID,
  IsBoolean,
  IsOptional,
  Matches,
  Min,
  Max,
} from 'class-validator';

export class CreateProviderScheduleDto {
  @IsUUID()
  providerId: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}
