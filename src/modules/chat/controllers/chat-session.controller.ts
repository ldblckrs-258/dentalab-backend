import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AuditMutation,
  CurrentUser,
  RequirePermissions,
} from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { PaginationQueryDto } from '@modules/pagination';
import { ChatSessionService } from '../services/chat-session.service';
import { CreateSessionDto } from '../dto/create-session.dto';
import { UpdateSessionDto } from '../dto/update-session.dto';

@Controller('chat/sessions')
export class ChatSessionController {
  constructor(private readonly sessions: ChatSessionService) {}

  @Get()
  @RequirePermissions('chat:use')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    const page = await this.sessions.list(user.id, query);
    const enriched = await this.sessions.enrichScopeMany(page.data, user);
    return { ...page, data: enriched };
  }

  @Get(':id')
  @RequirePermissions('chat:use')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const row = await this.sessions.getOwnedOrThrow(id, user.id);
    return this.sessions.enrichScope(row, user);
  }

  @Post()
  @RequirePermissions('chat:use')
  @AuditMutation({ code: 'CHAT_SESSION_STARTED', resource: 'chat' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSessionDto,
  ) {
    const row = await this.sessions.create(user.id, dto);
    return this.sessions.enrichScope(row, user);
  }

  @Patch(':id')
  @RequirePermissions('chat:use')
  @AuditMutation({ code: 'CHAT_SESSION_UPDATED', resource: 'chat_session' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSessionDto,
  ) {
    const row = await this.sessions.update(id, user, dto);
    return this.sessions.enrichScope(row, user);
  }

  @Delete(':id')
  @RequirePermissions('chat:use')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.sessions.remove(id, userId);
  }
}
