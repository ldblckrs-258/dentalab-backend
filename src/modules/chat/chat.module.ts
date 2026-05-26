import { Module } from '@nestjs/common';
import { RagModule } from '@modules/rag/rag.module';
import { AiConfigModule } from '@modules/ai-config/ai-config.module';
import { DocumentModule } from '@modules/document/document.module';
import { ChatSessionController } from './controllers/chat-session.controller';
import { ChatMessageController } from './controllers/chat-message.controller';
import { ChatStreamController } from './controllers/chat-stream.controller';
import { ChatSessionService } from './services/chat-session.service';
import { ChatMessageService } from './services/chat-message.service';
import { ChatRagService } from './services/chat-rag.service';
import { ChatLlmService } from './services/chat-llm.service';
import { CitationMapperService } from './services/citation-mapper.service';
import { ChatOrchestratorService } from './services/chat-orchestrator.service';
import { ChatStreamRegistryService } from './services/chat-stream-registry.service';
import { ChatScopeValidatorService } from './services/chat-scope-validator.service';

@Module({
  imports: [RagModule, AiConfigModule, DocumentModule],
  controllers: [
    ChatSessionController,
    ChatMessageController,
    ChatStreamController,
  ],
  providers: [
    ChatSessionService,
    ChatMessageService,
    ChatRagService,
    ChatLlmService,
    CitationMapperService,
    ChatOrchestratorService,
    ChatStreamRegistryService,
    ChatScopeValidatorService,
  ],
})
export class ChatModule {}
