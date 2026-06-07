import { IsHexColor, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOperatoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code: string;

  @IsHexColor()
  color: string;
}
