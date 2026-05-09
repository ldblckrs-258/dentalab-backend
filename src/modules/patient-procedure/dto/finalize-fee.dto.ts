import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class FinalizeFeeDto {
  @IsNumber()
  @Min(0)
  actualFee: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
