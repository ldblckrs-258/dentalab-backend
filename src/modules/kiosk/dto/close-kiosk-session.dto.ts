import { IsOptional, IsString } from 'class-validator';

export class CloseKioskSessionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
