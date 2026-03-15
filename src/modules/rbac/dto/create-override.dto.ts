import {
  IsUUID,
  IsIn,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

export class CreateOverrideDto {
  @IsUUID()
  permissionId: string;

  @IsIn(['grant', 'deny'])
  grantType: 'grant' | 'deny';

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
