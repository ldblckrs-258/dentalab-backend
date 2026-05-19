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
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.sessions.list(userId, query);
  }

  @Get(':id')
  @RequirePermissions('chat:use')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.sessions.getOwnedOrThrow(id, userId);
  }

  @Post()
  @RequirePermissions('chat:use')
  @AuditMutation({ code: 'CHAT_SESSION_STARTED', resource: 'chat' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessions.create(userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('chat:use')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessions.update(id, userId, dto);
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
