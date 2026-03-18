import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public, CurrentUser, RateLimit, Audited } from '@common/decorators';
import { t } from '@common/utils';
import { REFRESH_TOKEN_COOKIE } from '@common/constants';
import type { AuthenticatedUser } from '@common/interfaces';
import { AppConfigService } from '@modules/config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSeconds: 60, keyExtractor: 'ip+body:email' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, refreshExpiresIn, ...result } =
      await this.authService.login(dto);
    this.setRefreshTokenCookie(res, refreshToken, refreshExpiresIn);
    return result;
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as
      | string
      | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException(
        t('auth.refresh_token_not_found', 'Refresh token not found'),
      );
    }

    const {
      refreshToken: newToken,
      refreshExpiresIn,
      ...result
    } = await this.authService.refreshTokens({ refreshToken });
    this.setRefreshTokenCookie(res, newToken, refreshExpiresIn);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as
      | string
      | undefined;
    if (refreshToken) {
      await this.authService.logout(user.id, refreshToken);
    }
    this.clearRefreshTokenCookie(res);
    return { message: t('auth.logged_out', 'Logged out successfully') };
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
    return {
      message: t('auth.password_changed', 'Password changed successfully'),
    };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 3, windowSeconds: 60, keyExtractor: 'ip+body:email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return {
      message: t(
        'auth.reset_link_sent',
        'If the email exists, a reset link has been sent',
      ),
    };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return {
      message: t(
        'auth.password_reset_success',
        'Password has been reset successfully',
      ),
    };
  }

  private setRefreshTokenCookie(
    res: Response,
    token: string,
    maxAgeMs: number,
  ) {
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: this.config.app.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: maxAgeMs,
    });
  }

  private clearRefreshTokenCookie(res: Response) {
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      secure: this.config.app.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  }
}
