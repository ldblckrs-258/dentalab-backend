import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const TEMPLATE_TYPES = ['auth', 'reminder', 'notification', 'marketing'];

export class CreateEmailTemplateDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  subject: string;

  @IsString()
  body_mjml: string;

  @IsIn(TEMPLATE_TYPES)
  type: string;

  @IsOptional()
  variables?: { required: string[]; optional: string[] };
}
