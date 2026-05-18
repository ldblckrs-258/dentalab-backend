import { Module } from '@nestjs/common';
import { DocumentModule } from '@modules/document';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { RagConsumer } from './rag.consumer';
import { RagGateway } from './rag.gateway';

@Module({
  imports: [DocumentModule],
  controllers: [RagController],
  providers: [RagService, RagConsumer, RagGateway],
})
export class RagModule {}
