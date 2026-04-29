import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  Public,
  CurrentUser,
  RequirePermissions,
  AuditMutation,
} from '@common/decorators';
import { KioskService } from './kiosk.service';
import { CreateKioskSessionDto } from './dto/create-kiosk-session.dto';
import { AuthenticateKioskDto } from './dto/authenticate-kiosk.dto';
import { CloseKioskSessionDto } from './dto/close-kiosk-session.dto';
import { KioskAuthGuard } from './guards/kiosk-auth.guard';
import { KioskSession } from './decorators/kiosk-session.decorator';

@Controller('kiosk')
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  @Post('sessions')
  @RequirePermissions('kiosk_sessions:create')
  @AuditMutation({ code: 'KIOSK_SESSION_CREATED', resource: 'kiosk_session' })
  async createSession(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateKioskSessionDto,
  ) {
    return this.kioskService.createSession(userId, dto);
  }

  @Post('authenticate')
  @Public()
  @HttpCode(HttpStatus.OK)
  async authenticate(@Body() dto: AuthenticateKioskDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ip = req.ip;
    return this.kioskService.authenticate(dto, userAgent, ip);
  }

  @Get('sessions/:id/forms')
  @Public()
  @UseGuards(KioskAuthGuard)
  async getSessionForms(
    @Param('id') id: string,
    @KioskSession('id') sessionId: string,
  ) {
    if (id !== sessionId) {
      throw new ForbiddenException('Access denied to this session');
    }
    return this.kioskService.getSessionForms(id);
  }

  @Patch('sessions/:id/close')
  @RequirePermissions('kiosk_sessions:create')
  @AuditMutation({ code: 'KIOSK_SESSION_CLOSED', resource: 'kiosk_session' })
  @HttpCode(HttpStatus.OK)
  async closeSession(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CloseKioskSessionDto,
  ) {
    return this.kioskService.closeSession(id, userId, dto.reason);
  }
}
