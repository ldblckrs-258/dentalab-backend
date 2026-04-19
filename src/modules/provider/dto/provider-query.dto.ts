import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@modules/pagination';

export class ProviderQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
