import { IsIn, IsOptional, IsString } from 'class-validator';

export const TREATMENT_PLAN_STATUSES = [
  'draft',
  'proposed',
  'accepted',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type TreatmentPlanStatus = (typeof TREATMENT_PLAN_STATUSES)[number];

export class TransitionTreatmentPlanDto {
  @IsString()
  @IsIn(TREATMENT_PLAN_STATUSES)
  to: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
