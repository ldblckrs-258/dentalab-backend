import {
  Injectable,
  NotFoundException,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database/prisma.service';
import { AiCryptoService } from './ai-crypto.service';
import type { ProviderKind } from '../types';

const DISCOVERY_TIMEOUT_MS = 8000;

export interface DiscoveredModel {
  id: string;
  displayName?: string;
}

@Injectable()
export class ProviderModelDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AiCryptoService,
  ) {}

  async listAvailableModels(providerId: string): Promise<DiscoveredModel[]> {
    const provider = await this.prisma.client.aiProvider.findUnique({
      where: { id: providerId },
    });
    if (!provider) throw new NotFoundException('Provider not found');

    const apiKey = this.crypto.decrypt({
      ciphertext: Buffer.from(provider.apiKeyCiphertext),
      iv: Buffer.from(provider.apiKeyIv),
      tag: Buffer.from(provider.apiKeyTag),
    });

    const kind = provider.provider as ProviderKind;
    const baseUrl = provider.baseUrl ?? null;

    try {
      switch (kind) {
        case 'openai':
          return await this.fetchOpenAI(apiKey, baseUrl);
        case 'gemini':
          return await this.fetchGemini(apiKey, baseUrl);
        case 'anthropic':
          return await this.fetchAnthropic(apiKey, baseUrl);
        default:
          throw new BadRequestException(
            `Unsupported provider kind: ${String(kind)}`,
          );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : 'discovery failed';
      throw new BadGatewayException(`Provider discovery failed: ${msg}`);
    }
  }

  private async fetchOpenAI(
    apiKey: string,
    baseUrl: string | null,
  ): Promise<DiscoveredModel[]> {
    const url = `${trimSlash(baseUrl ?? 'https://api.openai.com/v1')}/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`OpenAI list-models HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: Array<{ id: string; owned_by?: string }>;
    };
    return (body.data ?? []).map((m) => ({ id: m.id }));
  }

  private async fetchGemini(
    apiKey: string,
    baseUrl: string | null,
  ): Promise<DiscoveredModel[]> {
    const root = trimSlash(
      baseUrl ?? 'https://generativelanguage.googleapis.com',
    );
    const url = `${root}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Gemini list-models HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      models?: Array<{
        name: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    return (body.models ?? [])
      .filter(
        (m) =>
          m.supportedGenerationMethods?.includes('generateContent') ?? true,
      )
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        displayName: m.displayName,
      }));
  }

  private async fetchAnthropic(
    apiKey: string,
    baseUrl: string | null,
  ): Promise<DiscoveredModel[]> {
    const url = `${trimSlash(baseUrl ?? 'https://api.anthropic.com')}/v1/models`;
    const res = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Anthropic list-models HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: Array<{ id: string; display_name?: string }>;
    };
    return (body.data ?? []).map((m) => ({
      id: m.id,
      displayName: m.display_name,
    }));
  }
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
