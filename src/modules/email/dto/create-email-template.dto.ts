import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { EMAIL_TEMPLATE_TYPES } from '../email.constants';

export class CreateEmailTemplateDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  subject: string;

  @IsString()
  body_mjml: string;

  @IsIn([...EMAIL_TEMPLATE_TYPES])
  type: string;

  @IsOptional()
  variables?: { required: string[]; optional: string[] };
}
