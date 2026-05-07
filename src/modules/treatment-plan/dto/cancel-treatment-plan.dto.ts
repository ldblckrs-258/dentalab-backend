import { IsString, MinLength } from 'class-validator';

export class CancelTreatmentPlanDto {
  @IsString()
  @MinLength(10)
  reason: string;
}
