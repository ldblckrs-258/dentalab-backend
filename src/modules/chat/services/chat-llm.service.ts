import { Injectable } from '@nestjs/common';
import { generateText, streamText, type CoreMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AppConfigService } from '@modules/config';
import type { ResolvedModelMeta } from '@modules/ai-config/types';

function buildModel(meta: ResolvedModelMeta, apiKey: string) {
  switch (meta.providerKind) {
    case 'openai':
      return createOpenAI({
        apiKey,
        baseURL: meta.baseUrl ?? undefined,
      })(meta.modelName);
    case 'gemini':
      return createGoogleGenerativeAI({
        apiKey,
        baseURL: meta.baseUrl ?? undefined,
      })(meta.modelName);
    case 'anthropic':
      return createAnthropic({
        apiKey,
        baseURL: meta.baseUrl ?? undefined,
      })(meta.modelName);
    default: {
      const exhaustive: never = meta.providerKind;
      throw new Error(`Unsupported provider: ${String(exhaustive)}`);
    }
  }
}

export function chainSignalWithDeadline(
  clientSignal: AbortSignal,
  timeoutMs: number,
): AbortSignal {
  const anyFn = (
    AbortSignal as unknown as {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === 'function') {
    return anyFn([clientSignal, AbortSignal.timeout(timeoutMs)]);
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  clientSignal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  ctrl.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      clientSignal.removeEventListener('abort', onAbort);
    },
    { once: true },
  );
  return ctrl.signal;
}

@Injectable()
export class ChatLlmService {
  constructor(private readonly config: AppConfigService) {}

  async generateRewrite(
    meta: ResolvedModelMeta,
    apiKey: string,
    prompt: string,
    clientSignal: AbortSignal,
  ): Promise<string> {
    const signal = chainSignalWithDeadline(
      clientSignal,
      this.config.ai.LLM_REWRITE_TIMEOUT_MS,
    );
    const { text } = await generateText({
      model: buildModel(meta, apiKey),
      prompt,
      abortSignal: signal,
      maxRetries: 0,
      temperature: meta.temperature,
      topP: meta.topP ?? undefined,
      maxTokens: meta.maxTokens ?? undefined,
    });
    return text.trim();
  }

  streamAnswer(
    meta: ResolvedModelMeta,
    apiKey: string,
    messages: CoreMessage[],
    clientSignal: AbortSignal,
  ): AsyncIterable<StreamPart> {
    const signal = chainSignalWithDeadline(
      clientSignal,
      this.config.ai.LLM_ANSWER_TIMEOUT_MS,
    );
    const result = streamText({
      model: buildModel(meta, apiKey),
      messages,
      abortSignal: signal,
      maxRetries: 0,
      temperature: meta.temperature,
      topP: meta.topP ?? undefined,
      maxTokens: meta.maxTokens ?? undefined,
    });
    return (async function* () {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          yield { type: 'text' as const, text: part.textDelta };
        } else if (part.type === 'reasoning') {
          yield { type: 'reasoning' as const, text: part.textDelta };
        }
      }
    })();
  }
}

export type StreamPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string };
