import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@modules/pagination';
import { EMAIL_STATUSES } from '../email.constants';
import type { EmailStatus } from '../email.constants';

export class EmailQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(EMAIL_STATUSES)
  status?: EmailStatus;

  @IsOptional()
  @IsString()
  templateName?: string;

  @IsOptional()
  @IsString()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;
}
