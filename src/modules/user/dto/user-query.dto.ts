import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@modules/pagination';

export class UserQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;
}
