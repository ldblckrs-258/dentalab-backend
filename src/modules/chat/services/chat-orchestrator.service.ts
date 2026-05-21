import { AiResolverService } from '@modules/ai-config/services/ai-resolver.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { SseWriter } from '../sse/sse-writer';
import { ChatLlmService } from './chat-llm.service';
import { ChatMessageService } from './chat-message.service';
import { buildChatMessages, buildRewritePrompt } from './chat-prompts';
import { ChatRagService } from './chat-rag.service';
import { ChatSessionService } from './chat-session.service';
import { CitationMapperService } from './citation-mapper.service';

interface RunTurnArgs {
  sessionId: string;
  userId: string;
  userMessage: string;
  clientSignal: AbortSignal;
  writer: SseWriter;
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly sessions: ChatSessionService,
    private readonly messages: ChatMessageService,
    private readonly resolver: AiResolverService,
    private readonly rag: ChatRagService,
    private readonly mapper: CitationMapperService,
    private readonly llm: ChatLlmService,
  ) {}

  async runTurn(args: RunTurnArgs): Promise<void> {
    const { sessionId, userId, userMessage, clientSignal, writer } = args;

    if (this.inFlight.has(sessionId)) {
      throw new ConflictException('stream_already_active');
    }
    this.inFlight.add(sessionId);

    try {
      const session = await this.sessions.getOwnedOrThrow(sessionId, userId);

      const rewrite = await this.resolver.getRewriteModel();
      const answer = await this.resolver.getAnswerModel(
        session.answerModelId ?? undefined,
      );

      const history = await this.messages.lastN(
        sessionId,
        answer.meta.historyWindow,
      );

      const userMsg = await this.messages.append(
        sessionId,
        'user',
        userMessage,
        null,
      );
      writer.emit('session', {
        sessionId,
        userMessageId: userMsg.id,
      });

      let rewritten: string;
      try {
        rewritten = await this.llm.generateRewrite(
          rewrite.meta,
          rewrite.decryptedApiKey,
          buildRewritePrompt(
            history,
            userMessage,
            rewrite.meta.userInstruction,
          ),
          clientSignal,
        );
      } catch (e) {
        if (clientSignal.aborted) {
          writer.emit('error', { code: 'aborted' });
          return;
        }
        if (isAbortError(e)) {
          writer.emit('error', { code: 'timeout' });
          return;
        }
        throw e;
      }
      writer.emit('rewritten', { query: rewritten });

      if (!session.title) {
        const userMessageCount =
          await this.messages.countUserMessages(sessionId);
        if (userMessageCount === 1) {
          try {
            await this.sessions.setTitleIfEmpty(sessionId, rewritten);
          } catch (e) {
            this.logger.warn(`setTitleIfEmpty failed: ${(e as Error).message}`);
          }
        }
      }

      let ragHits: RagSearchResult[];
      try {
        ragHits = await this.rag.query(rewritten, userId, answer.meta.ragTopK);
      } catch (e) {
        this.logger.warn(`RAG query failed: ${(e as Error).message}`);
        writer.emit('error', { code: 'rag_unavailable' });
        return;
      }

      const { citations, dedupedHits } = await this.mapper.toCitations(ragHits);
      writer.emit('citations', { sources: citations });

      const chatMessages = buildChatMessages(
        history,
        userMessage,
        citations,
        dedupedHits,
        answer.meta.userInstruction,
      );

      let full = '';
      let fullReasoning = '';
      let firstChunkAt: number | null = null;
      const startedAt = Date.now();
      try {
        for await (const part of this.llm.streamAnswer(
          answer.meta,
          answer.decryptedApiKey,
          chatMessages,
          clientSignal,
        )) {
          firstChunkAt ??= Date.now();
          if (part.type === 'reasoning') {
            fullReasoning += part.text;
            writer.emit('reasoning', { text: part.text });
          } else {
            full += part.text;
            writer.emit('delta', { text: part.text });
          }
        }
      } catch (e) {
        const aborted = clientSignal.aborted;
        const timedOut = !aborted && isAbortError(e);
        if (aborted || timedOut) {
          if (full || fullReasoning) {
            await this.messages.append(
              sessionId,
              'assistant',
              full,
              citations as unknown,
              {
                aborted,
                timedOut,
                ...(fullReasoning ? { reasoning: fullReasoning } : {}),
              },
            );
          }
          writer.emit('error', { code: aborted ? 'aborted' : 'timeout' });
          return;
        }
        this.logger.error(`Answer stream failed: ${(e as Error).message}`);
        writer.emit('error', { code: 'internal' });
        return;
      }

      const assistantMsg = await this.messages.append(
        sessionId,
        'assistant',
        full,
        citations as unknown,
        fullReasoning ? { reasoning: fullReasoning } : null,
      );

      writer.emit('done', {
        messageId: assistantMsg.id,
        timing: {
          totalMs: Date.now() - startedAt,
          firstChunkMs: firstChunkAt ? firstChunkAt - startedAt : null,
        },
      });
    } finally {
      this.inFlight.delete(sessionId);
    }
  }
}
