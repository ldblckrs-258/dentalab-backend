import { IsNotEmpty, IsString } from 'class-validator';

export class AuthenticateKioskDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
