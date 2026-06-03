import { IsUUID, IsOptional } from 'class-validator';

export class ProvidersQueryDto {
  @IsUUID()
  @IsOptional()
  typeId?: string;
}
