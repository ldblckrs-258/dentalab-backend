import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateProviderDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  license_number?: string;
}
