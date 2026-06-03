import { IsUUID, IsString, IsOptional, Matches } from 'class-validator';

export class SlotsQueryDto {
  @IsUUID()
  typeId: string;

  @IsUUID()
  @IsOptional()
  providerId?: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}
