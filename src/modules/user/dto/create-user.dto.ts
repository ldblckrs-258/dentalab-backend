import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '@common/constants';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  full_name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one lowercase, one uppercase and one digit',
  })
  password: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  roleIds?: string[];
}
