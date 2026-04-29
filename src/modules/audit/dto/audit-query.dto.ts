import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationQueryDto } from '@modules/pagination';

export class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsString()
  eventCode?: string;

  @IsOptional()
  @IsIn(['auth', 'rbac', 'phi', 'ops', 'system', 'security'])
  category?: string;

  @IsOptional()
  @IsIn(['info', 'notice', 'warning', 'critical'])
  severity?: string;

  @IsOptional()
  @IsIn(['success', 'failure', 'denied'])
  outcome?: string;

  @IsOptional()
  @IsString()
  resource?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsString()
  actorRoleCode?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;
}
