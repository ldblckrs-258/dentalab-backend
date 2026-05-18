import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { RagService } from './rag.service';

@Controller('documents/:id')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Get('rag-status')
  @RequirePermissions('internal_documents:read')
  async getRagStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.ragService.getRagStatus(id, user);
  }

  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('internal_documents:update')
  async reindex(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser & { permissions?: string[] },
  ) {
    return this.ragService.reindex(id, user);
  }
}
