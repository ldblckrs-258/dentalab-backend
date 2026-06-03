import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BookingPatientDto {
  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsString()
  @MaxLength(20)
  phone: string;

  @IsISO8601()
  @IsOptional()
  dateOfBirth?: string;

  @IsIn(['male', 'female', 'other'])
  @IsOptional()
  gender?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  address?: string;
}

export class CreateBookingDto {
  @IsUUID()
  typeId: string;

  @IsUUID()
  @IsOptional()
  providerId?: string;

  @IsISO8601()
  startTime: string;

  @ValidateNested()
  @Type(() => BookingPatientDto)
  patient: BookingPatientDto;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  chiefComplaint?: string;
}
