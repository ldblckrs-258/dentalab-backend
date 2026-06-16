import { Module } from '@nestjs/common';
import { DocumentModule } from '@modules/document';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { RagConsumer } from './rag.consumer';
import { RagGateway } from './rag.gateway';
import { ClinicalNoteRagGateway } from './rag.clinical-note.gateway';
import { RagSearchService } from './rag-search.service';
import { RagSearchController } from './rag-search.controller';
import { RagDebugService } from './rag-debug.service';
import { RagDebugController } from './rag-debug.controller';
import { InternalTokenGuard } from './guards/internal-token.guard';

@Module({
  imports: [DocumentModule],
  controllers: [RagController, RagSearchController, RagDebugController],
  providers: [
    RagService,
    RagConsumer,
    RagGateway,
    ClinicalNoteRagGateway,
    RagSearchService,
    RagDebugService,
    InternalTokenGuard,
  ],
  exports: [RagSearchService, RagService],
})
export class RagModule {}
