import { Public, RateLimit, SkipResponseWrap } from '@common/decorators';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RagDebugSearchDto } from './dto/rag-debug-search.dto';
import { InternalTokenGuard } from './guards/internal-token.guard';
import { RagDebugService } from './rag-debug.service';

@Controller('rag')
export class RagDebugController {
  constructor(private readonly ragDebugService: RagDebugService) {}

  @Post('search/debug')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(InternalTokenGuard)
  @RateLimit({ skip: true })
  @SkipResponseWrap()
  async debugSearch(@Body() dto: RagDebugSearchDto): Promise<unknown> {
    return this.ragDebugService.debugSearch(dto);
  }
}
