import {
  Body,
  ConflictException,
  Controller,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  RateLimit,
  RequirePermissions,
  SkipResponseWrap,
} from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { ChatOrchestratorService } from '../services/chat-orchestrator.service';
import { SendMessageDto } from '../dto/send-message.dto';
import { SseWriter } from '../sse/sse-writer';

@Controller('chat/sessions')
export class ChatStreamController {
  private readonly logger = new Logger(ChatStreamController.name);

  constructor(private readonly orch: ChatOrchestratorService) {}

  @Post(':id/stream')
  @RequirePermissions('chat:use')
  @SkipResponseWrap()
  @RateLimit({ limit: 10, windowSeconds: 60 })
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const ac = new AbortController();
    req.on('close', () => ac.abort());

    const writer = new SseWriter(res);

    try {
      await this.orch.runTurn({
        sessionId: id,
        user,
        userMessage: dto.content,
        clientSignal: ac.signal,
        writer,
      });
    } catch (e) {
      if (e instanceof ConflictException) {
        res.status(HttpStatus.CONFLICT);
        writer.emit('error', { code: 'stream_already_active' });
      } else {
        this.logger.error(
          `runTurn failed: ${(e as Error).message}`,
          (e as Error).stack,
        );
        writer.emit('error', { code: 'internal' });
      }
    } finally {
      writer.close();
    }
  }
}
