import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class ReviewScheduleOverrideDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @ValidateIf((o) => o.decision === 'reject')
  @IsNotEmpty()
  @IsString()
  reviewNote?: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
