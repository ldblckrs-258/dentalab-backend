import { IsIn, IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class ReviewScheduleOverrideDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @ValidateIf((o: ReviewScheduleOverrideDto) => o.decision === 'reject')
  @IsString()
  @IsNotEmpty()
  reviewNote?: string;
}
