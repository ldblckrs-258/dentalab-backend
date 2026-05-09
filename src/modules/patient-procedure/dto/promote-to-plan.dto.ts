import { IsUUID } from 'class-validator';

export class PromoteToPlanDto {
  @IsUUID()
  treatmentPlanId: string;
}
