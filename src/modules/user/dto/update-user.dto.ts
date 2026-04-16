import { Transform } from 'class-transformer';
import { IsOptional, IsString, MinLength } from 'class-validator';

// Admin-facing update: excludes preferredLanguage by design — users set their
// own language via PATCH /users/me.
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  removeAvatar?: boolean;
}
