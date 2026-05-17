import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateClinicalNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  subjective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  objective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  assessment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  plan?: string;
}
