import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const TEMPLATE_TYPES = ['auth', 'reminder', 'notification', 'marketing'];

export class UpdateEmailTemplateDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body_mjml?: string;

  @IsOptional()
  @IsIn(TEMPLATE_TYPES)
  type?: string;

  @IsOptional()
  variables?: { required: string[]; optional: string[] };

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
