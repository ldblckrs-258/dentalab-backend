import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/database/prisma.service';
import { CacheService } from '@modules/redis';
import { AiCryptoService } from './ai-crypto.service';
import type { ProviderKind, ResolvedModel, ResolvedModelMeta } from '../types';

const CACHE_DOMAIN = 'ai_resolver';
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class AiResolverService {
  private readonly logger = new Logger(AiResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly crypto: AiCryptoService,
  ) {}

  async getAnswerModel(modelId?: string): Promise<ResolvedModel> {
    const where = modelId
      ? { id: modelId, role: 'answer', isActive: true }
      : { role: 'answer', isDefault: true, isActive: true };

    const model = await this.prisma.client.aiModel.findFirst({ where });
    if (!model) {
      throw new NotFoundException(
        modelId
          ? `Answer model ${modelId} not found or inactive`
          : 'No default answer model configured',
      );
    }
    return this.resolveByModelId(model.id);
  }

  async getRewriteModel(): Promise<ResolvedModel> {
    const model = await this.prisma.client.aiModel.findFirst({
      where: { role: 'rewrite', isActive: true },
    });
    if (!model) {
      throw new ServiceUnavailableException(
        'No active rewrite model configured',
      );
    }
    return this.resolveByModelId(model.id);
  }

  async invalidateModel(modelId: string): Promise<void> {
    await this.cache.del(CACHE_DOMAIN, `model:${modelId}`);
  }

  async invalidateProvider(providerId: string): Promise<void> {
    const models = await this.prisma.client.aiModel.findMany({
      where: { providerId },
      select: { id: true },
    });
    await Promise.all(
      models.map((m) => this.cache.del(CACHE_DOMAIN, `model:${m.id}`)),
    );
  }

  private async resolveByModelId(modelId: string): Promise<ResolvedModel> {
    const cacheKey = `model:${modelId}`;
    let meta = await this.cache.get<ResolvedModelMeta>(CACHE_DOMAIN, cacheKey);

    if (!meta) {
      const model = await this.prisma.client.aiModel.findUnique({
        where: { id: modelId },
        include: { provider: true },
      });
      if (!model) {
        throw new NotFoundException(`Model ${modelId} not found`);
      }
      if (!model.provider.isActive) {
        throw new ServiceUnavailableException(
          `Provider ${model.provider.name} is disabled`,
        );
      }
      meta = {
        modelId: model.id,
        providerId: model.providerId,
        providerKind: model.provider.provider as ProviderKind,
        baseUrl: model.provider.baseUrl,
        modelName: model.modelName,
        userInstruction: model.userInstruction,
        temperature: model.temperature,
        topP: model.topP,
        maxTokens: model.maxTokens,
        ragTopK: model.ragTopK,
        historyWindow: model.historyWindow,
      };
      await this.cache.set(CACHE_DOMAIN, cacheKey, meta, CACHE_TTL_SECONDS);
    }

    const provider = await this.prisma.client.aiProvider.findUnique({
      where: { id: meta.providerId },
      select: {
        apiKeyCiphertext: true,
        apiKeyIv: true,
        apiKeyTag: true,
        isActive: true,
      },
    });
    if (!provider) {
      await this.invalidateModel(modelId);
      throw new NotFoundException('Provider missing');
    }
    if (!provider.isActive) {
      await this.invalidateModel(modelId);
      throw new ServiceUnavailableException('Provider disabled');
    }

    let decryptedApiKey: string;
    try {
      decryptedApiKey = this.crypto.decrypt({
        ciphertext: Buffer.from(provider.apiKeyCiphertext),
        iv: Buffer.from(provider.apiKeyIv),
        tag: Buffer.from(provider.apiKeyTag),
      });
    } catch (err) {
      this.logger.error(
        `Failed to decrypt provider ${meta.providerId} key: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('Provider key undecryptable');
    }

    return { meta, decryptedApiKey };
  }
}
