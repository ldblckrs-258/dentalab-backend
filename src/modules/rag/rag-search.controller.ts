import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '@common/decorators';
import type { AuthenticatedUser } from '@common/interfaces';
import { RagSearchService } from './rag-search.service';
import { RagSearchDto } from './dto/rag-search.dto';
import type { RagSearchResponse } from './dto/rag-search-result.dto';

@Controller('rag')
export class RagSearchController {
  constructor(private readonly ragSearchService: RagSearchService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('internal_documents:read')
  async search(
    @Body() dto: RagSearchDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RagSearchResponse> {
    return this.ragSearchService.search(dto, user);
  }
}
