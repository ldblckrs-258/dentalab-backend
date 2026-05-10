import { PaginationQueryDto } from '@modules/pagination';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class ScheduleOverviewQueryDto extends PaginationQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  providerId?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialty?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(['pending', 'approved', 'rejected', 'cancelled'], { each: true })
  overrideStatus?: string[];
}
