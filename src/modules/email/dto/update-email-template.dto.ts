import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { EMAIL_TEMPLATE_TYPES } from '../email.constants';

export class UpdateEmailTemplateDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body_mjml?: string;

  @IsOptional()
  @IsIn([...EMAIL_TEMPLATE_TYPES])
  type?: string;

  @IsOptional()
  variables?: { required: string[]; optional: string[] };

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
