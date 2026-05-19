import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '@common/decorators';
import { PaginationQueryDto } from '@modules/pagination';
import { ChatSessionService } from '../services/chat-session.service';
import { ChatMessageService } from '../services/chat-message.service';

@Controller('chat/sessions/:sessionId/messages')
export class ChatMessageController {
  constructor(
    private readonly sessions: ChatSessionService,
    private readonly messages: ChatMessageService,
  ) {}

  @Get()
  @RequirePermissions('chat:use')
  async list(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    await this.sessions.getOwnedOrThrow(sessionId, userId);
    return this.messages.list(sessionId, query);
  }
}
