import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { Public, CurrentUser, RateLimit, Audited } from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSeconds: 60, keyExtractor: 'ip+body:email' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshTokenDto,
  ) {
    await this.authService.logout(user.id, dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Put('change-password')
  @Audited('user')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user.id, dto);
    return { message: 'Password changed successfully' };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 3, windowSeconds: 60, keyExtractor: 'ip+body:email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return { message: 'If the email exists, a reset link has been sent' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Password has been reset successfully' };
  }
}
