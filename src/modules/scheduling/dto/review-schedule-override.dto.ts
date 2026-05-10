import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReviewScheduleOverrideDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  reviewNote?: string;
}
