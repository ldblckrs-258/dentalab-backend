/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { Test } from '@nestjs/testing';
import { AiResolverService } from '@modules/ai-config/services/ai-resolver.service';
import { ChatLlmService } from './chat-llm.service';
import { ChatMessageService } from './chat-message.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { ChatRagService } from './chat-rag.service';
import { ChatSessionService } from './chat-session.service';
import { CitationMapperService } from './citation-mapper.service';
import type { SseWriter } from '../sse/sse-writer';

interface EmitCall {
  event: string;
  data: unknown;
}

function makeWriter(): SseWriter & { calls: EmitCall[] } {
  const calls: EmitCall[] = [];
  const writer = {
    emit: jest.fn((event: string, data: unknown) => {
      calls.push({ event, data });
    }),
    close: jest.fn(),
    calls,
  };
  return writer as unknown as SseWriter & { calls: EmitCall[] };
}

const baseMeta = {
  modelId: 'm1',
  providerId: 'p1',
  providerKind: 'gemini' as const,
  baseUrl: null,
  modelName: 'gemini-2.0-flash',
  systemPrompt: 'sys',
  temperature: 0.4,
  topP: null,
  maxTokens: null,
  ragTopK: 5,
  historyWindow: 8,
};

describe('ChatOrchestratorService.runTurn', () => {
  let orch: ChatOrchestratorService;
  let sessions: jest.Mocked<ChatSessionService>;
  let messages: jest.Mocked<ChatMessageService>;
  let resolver: jest.Mocked<AiResolverService>;
  let rag: jest.Mocked<ChatRagService>;
  let mapper: jest.Mocked<CitationMapperService>;
  let llm: jest.Mocked<ChatLlmService>;

  beforeEach(async () => {
    sessions = {
      getOwnedOrThrow: jest.fn().mockResolvedValue({
        id: 's1',
        userId: 'u1',
        answerModelId: 'm1',
        title: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as unknown as jest.Mocked<ChatSessionService>;

    messages = {
      append: jest.fn().mockResolvedValue({ id: 'mid-x' }),
      lastN: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ChatMessageService>;

    resolver = {
      getRewriteModel: jest.fn().mockResolvedValue({
        meta: { ...baseMeta, modelId: 'rw' },
        decryptedApiKey: 'rk',
      }),
      getAnswerModel: jest.fn().mockResolvedValue({
        meta: baseMeta,
        decryptedApiKey: 'ak',
      }),
    } as unknown as jest.Mocked<AiResolverService>;

    rag = {
      query: jest.fn().mockResolvedValue([
        {
          childChunkId: 'c',
          parentChunkId: 'p',
          ragDocumentId: 'r',
          sourceType: 'internal_document',
          sourceId: 'doc-1',
          filename: null,
          childContent: 'context content',
          parentContent: 'context',
          score: 0.9,
          metadata: null,
          heading: null,
          headingLevel: 0,
          breadcrumbs: [],
        },
      ]),
    } as unknown as jest.Mocked<ChatRagService>;

    mapper = {
      toCitations: jest.fn().mockResolvedValue([
        {
          sourceId: 'doc-1',
          title: 'Doc',
          heading: null,
          snippet: 'ctx',
          score: 0.9,
          linkTo: '/documents/doc-1',
        },
      ]),
    } as unknown as jest.Mocked<CitationMapperService>;

    llm = {
      generateRewrite: jest.fn().mockResolvedValue('rewritten question'),
      streamAnswer: jest.fn().mockReturnValue(
        (async function* () {
          yield { type: 'text', text: 'Hello' };
          yield { type: 'text', text: ' world' };
        })(),
      ),
    } as unknown as jest.Mocked<ChatLlmService>;

    const module = await Test.createTestingModule({
      providers: [
        ChatOrchestratorService,
        { provide: ChatSessionService, useValue: sessions },
        { provide: ChatMessageService, useValue: messages },
        { provide: AiResolverService, useValue: resolver },
        { provide: ChatRagService, useValue: rag },
        { provide: CitationMapperService, useValue: mapper },
        { provide: ChatLlmService, useValue: llm },
      ],
    }).compile();

    orch = module.get(ChatOrchestratorService);
  });

  it('emits events in order: session, rewritten, citations, delta…, done', async () => {
    const writer = makeWriter();
    const ac = new AbortController();
    await orch.runTurn({
      sessionId: 's1',
      userId: 'u1',
      userMessage: 'q',
      clientSignal: ac.signal,
      writer,
    });
    const events = (writer as unknown as { calls: EmitCall[] }).calls.map(
      (c) => c.event,
    );
    expect(events).toEqual([
      'session',
      'rewritten',
      'citations',
      'delta',
      'delta',
      'done',
    ]);
  });

  it('persists user + assistant messages on happy path', async () => {
    const writer = makeWriter();
    const ac = new AbortController();
    await orch.runTurn({
      sessionId: 's1',
      userId: 'u1',
      userMessage: 'q',
      clientSignal: ac.signal,
      writer,
    });
    expect(messages.append).toHaveBeenCalledTimes(2);
    const assistantCall = messages.append.mock.calls[1];
    expect(assistantCall[1]).toBe('assistant');
    expect(assistantCall[2]).toBe('Hello world');
  });

  it('on client abort mid-stream → emits error{aborted} + persists partial with metadata.aborted=true', async () => {
    const ac = new AbortController();
    llm.streamAnswer.mockImplementation(() =>
      (async function* () {
        yield { type: 'text', text: 'partial' };
        ac.abort();
        throw Object.assign(new Error('aborted'), {
          name: 'AbortError',
        });
      })(),
    );
    const writer = makeWriter();
    await orch.runTurn({
      sessionId: 's1',
      userId: 'u1',
      userMessage: 'q',
      clientSignal: ac.signal,
      writer,
    });
    const errEvent = (writer as unknown as { calls: EmitCall[] }).calls.find(
      (c) => c.event === 'error',
    );
    expect(errEvent?.data).toEqual({ code: 'aborted' });
    const assistantPersist = messages.append.mock.calls.find(
      (c) => c[1] === 'assistant',
    );
    expect(assistantPersist).toBeDefined();
    expect(assistantPersist![4]).toMatchObject({ aborted: true });
  });

  it('emits reasoning events and persists metadata.reasoning on happy path', async () => {
    llm.streamAnswer.mockImplementation(() =>
      (async function* () {
        yield { type: 'reasoning', text: 'think ' };
        yield { type: 'reasoning', text: 'step' };
        yield { type: 'text', text: 'Answer' };
      })(),
    );
    const writer = makeWriter();
    const ac = new AbortController();
    await orch.runTurn({
      sessionId: 's1',
      userId: 'u1',
      userMessage: 'q',
      clientSignal: ac.signal,
      writer,
    });
    const events = (writer as unknown as { calls: EmitCall[] }).calls;
    const reasoningEvents = events.filter((c) => c.event === 'reasoning');
    expect(reasoningEvents).toHaveLength(2);
    expect(reasoningEvents[0].data).toEqual({ text: 'think ' });
    const assistantCall = messages.append.mock.calls.find(
      (c) => c[1] === 'assistant',
    );
    expect(assistantCall![2]).toBe('Answer');
    expect(assistantCall![4]).toEqual({ reasoning: 'think step' });
  });

  it('persists partial metadata.reasoning when aborted mid-reasoning', async () => {
    const ac = new AbortController();
    llm.streamAnswer.mockImplementation(() =>
      (async function* () {
        yield { type: 'reasoning', text: 'partial-think' };
        ac.abort();
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      })(),
    );
    const writer = makeWriter();
    await orch.runTurn({
      sessionId: 's1',
      userId: 'u1',
      userMessage: 'q',
      clientSignal: ac.signal,
      writer,
    });
    const assistantPersist = messages.append.mock.calls.find(
      (c) => c[1] === 'assistant',
    );
    expect(assistantPersist![4]).toMatchObject({
      aborted: true,
      reasoning: 'partial-think',
    });
  });

  it('on LLM timeout (no client abort) → emits error{timeout} + persists partial with metadata.timedOut=true', async () => {
    const ac = new AbortController();
    llm.streamAnswer.mockImplementation(() =>
      (async function* () {
        yield { type: 'text', text: 'partial' };
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      })(),
    );
    const writer = makeWriter();
    await orch.runTurn({
      sessionId: 's1',
      userId: 'u1',
      userMessage: 'q',
      clientSignal: ac.signal,
      writer,
    });
    const errEvent = (writer as unknown as { calls: EmitCall[] }).calls.find(
      (c) => c.event === 'error',
    );
    expect(errEvent?.data).toEqual({ code: 'timeout' });
    const assistantPersist = messages.append.mock.calls.find(
      (c) => c[1] === 'assistant',
    );
    expect(assistantPersist![4]).toMatchObject({ timedOut: true });
  });

  it('rejects concurrent stream on same sessionId with ConflictException', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    llm.streamAnswer.mockImplementation(() =>
      (async function* () {
        await gate;
        yield { type: 'text', text: 'x' };
      })(),
    );
    const writer1 = makeWriter();
    const writer2 = makeWriter();
    const ac = new AbortController();
    const first = orch.runTurn({
      sessionId: 's1',
      userId: 'u1',
      userMessage: 'q',
      clientSignal: ac.signal,
      writer: writer1,
    });
    await new Promise((r) => setImmediate(r));
    await expect(
      orch.runTurn({
        sessionId: 's1',
        userId: 'u1',
        userMessage: 'q2',
        clientSignal: ac.signal,
        writer: writer2,
      }),
    ).rejects.toThrow(/stream_already_active/);
    release();
    await first;
  });
});
