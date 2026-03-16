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
  UseGuards,
} from '@nestjs/common';
import {
  Public,
  CurrentUser,
  RequirePermissions,
  Audited,
} from '@common/decorators';
import { KioskService } from './kiosk.service';
import { CreateKioskSessionDto } from './dto/create-kiosk-session.dto';
import { AuthenticateKioskDto } from './dto/authenticate-kiosk.dto';
import { KioskAuthGuard } from './guards/kiosk-auth.guard';
import { KioskSession } from './decorators/kiosk-session.decorator';

@Controller('kiosk')
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  @Post('sessions')
  @RequirePermissions('kiosk_sessions:create')
  @Audited('kiosk_session')
  async createSession(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateKioskSessionDto,
  ) {
    return this.kioskService.createSession(userId, dto);
  }

  @Post('authenticate')
  @Public()
  @HttpCode(HttpStatus.OK)
  async authenticate(@Body() dto: AuthenticateKioskDto) {
    return this.kioskService.authenticate(dto);
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
  @Public()
  @UseGuards(KioskAuthGuard)
  @HttpCode(HttpStatus.OK)
  async closeSession(
    @Param('id') id: string,
    @KioskSession('id') sessionId: string,
  ) {
    if (id !== sessionId) {
      throw new ForbiddenException('Access denied to this session');
    }
    return this.kioskService.closeSession(id);
  }
}
