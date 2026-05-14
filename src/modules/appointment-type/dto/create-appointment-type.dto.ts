import {
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAppointmentTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsInt()
  @Min(1)
  durationMinutes: number;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsHexColor()
  textColor?: string;
}
