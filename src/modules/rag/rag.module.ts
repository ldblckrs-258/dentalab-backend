import { Module } from '@nestjs/common';
import { DocumentModule } from '@modules/document';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { RagConsumer } from './rag.consumer';
import { RagGateway } from './rag.gateway';
import { RagSearchService } from './rag-search.service';
import { RagSearchController } from './rag-search.controller';

@Module({
  imports: [DocumentModule],
  controllers: [RagController, RagSearchController],
  providers: [RagService, RagConsumer, RagGateway, RagSearchService],
})
export class RagModule {}
