import { AiResolverService } from '@modules/ai-config/services/ai-resolver.service';
import type { RagSearchResult } from '@modules/rag/dto/rag-search-result.dto';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/interfaces';
import type { SseWriter } from '../sse/sse-writer';
import { ChatLlmService } from './chat-llm.service';
import { ChatMessageService } from './chat-message.service';
import { buildChatMessages, buildRewritePrompt } from './chat-prompts';
import { ChatRagService } from './chat-rag.service';
import { ChatSessionService } from './chat-session.service';
import { CitationMapperService } from './citation-mapper.service';
import { ChatStreamRegistryService } from './chat-stream-registry.service';
import {
  ChatScopeValidatorService,
  type EffectiveScope,
} from './chat-scope-validator.service';

interface RunTurnArgs {
  sessionId: string;
  user: AuthenticatedUser;
  userMessage: string;
  clientSignal: AbortSignal;
  writer: SseWriter;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private readonly sessions: ChatSessionService,
    private readonly messages: ChatMessageService,
    private readonly resolver: AiResolverService,
    private readonly rag: ChatRagService,
    private readonly mapper: CitationMapperService,
    private readonly llm: ChatLlmService,
    private readonly streamRegistry: ChatStreamRegistryService,
    private readonly scopeValidator: ChatScopeValidatorService,
  ) {}

  async isStreaming(sessionId: string): Promise<boolean> {
    return this.streamRegistry.isActive(sessionId);
  }

  async runTurn(args: RunTurnArgs): Promise<void> {
    const { sessionId, user, userMessage, clientSignal, writer } = args;
    const userId = user.id;

    const acquired = await this.streamRegistry.acquire(sessionId);
    if (!acquired) {
      throw new ConflictException('stream_already_active');
    }

    const hardCapMs = ChatStreamRegistryService.hardCapSeconds * 1000;
    const startedAt = Date.now();
    const turnAc = new AbortController();
    const forwardClientAbort = () => turnAc.abort();
    if (clientSignal.aborted) {
      turnAc.abort();
    } else {
      clientSignal.addEventListener('abort', forwardClientAbort, {
        once: true,
      });
    }
    const turnSignal = turnAc.signal;
    const heartbeat = setInterval(() => {
      void this.streamRegistry.refresh(sessionId).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    const hardCap = setTimeout(() => {
      this.logger.warn(`Stream ${sessionId} hit hard cap, forcing abort`);
      turnAc.abort();
    }, hardCapMs);

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
          turnSignal,
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

      let effectiveScope: EffectiveScope | null = null;
      try {
        effectiveScope = await this.scopeValidator.materializeForTurn(
          {
            scopeType: session.scopeType ?? null,
            scopePatientId: session.scopePatientId ?? null,
            scopeRagDocumentIds: session.scopeRagDocumentIds ?? [],
          },
          user,
        );
      } catch (e) {
        this.logger.warn(`materializeForTurn failed: ${(e as Error).message}`);
        effectiveScope = null;
      }

      if (effectiveScope?.removed) {
        writer.emit('scope_changed', { removed: effectiveScope.removed });
      }

      let ragHits: RagSearchResult[];
      try {
        ragHits = await this.rag.query(
          rewritten,
          user,
          answer.meta.ragTopK,
          effectiveScope && !effectiveScope.removed
            ? effectiveScope
            : effectiveScope &&
                (effectiveScope.patientId ||
                  (effectiveScope.ragDocumentIds &&
                    effectiveScope.ragDocumentIds.length > 0))
              ? effectiveScope
              : null,
        );
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
      try {
        for await (const part of this.llm.streamAnswer(
          answer.meta,
          answer.decryptedApiKey,
          chatMessages,
          turnSignal,
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
      clearInterval(heartbeat);
      clearTimeout(hardCap);
      await this.streamRegistry.release(sessionId);
    }
  }
}
