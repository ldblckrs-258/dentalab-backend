import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const TRANSITIONABLE_STATUSES = [
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'no_show',
] as const;

export type TransitionableStatus = (typeof TRANSITIONABLE_STATUSES)[number];

export class TransitionStatusDto {
  @IsString()
  @IsIn([...TRANSITIONABLE_STATUSES])
  status: TransitionableStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
