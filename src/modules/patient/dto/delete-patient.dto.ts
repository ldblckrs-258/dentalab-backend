import { IsString, MinLength } from 'class-validator';

export class DeletePatientDto {
  @IsString()
  @MinLength(10)
  reason: string;
}
