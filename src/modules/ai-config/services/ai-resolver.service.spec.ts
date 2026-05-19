import { Test } from '@nestjs/testing';
import { PrismaService } from '@modules/database/prisma.service';
import { CacheService } from '@modules/redis';
import { AiCryptoService } from './ai-crypto.service';
import { AiResolverService } from './ai-resolver.service';

describe('AiResolverService', () => {
  let service: AiResolverService;
  let aiModelFindUnique: jest.Mock;
  let aiModelFindFirst: jest.Mock;
  let aiModelFindMany: jest.Mock;
  let aiProviderFindUnique: jest.Mock;
  let cacheGet: jest.Mock;
  let cacheSet: jest.Mock;
  let cacheDel: jest.Mock;
  let decrypt: jest.Mock;

  const baseModel = {
    id: 'm1',
    providerId: 'p1',
    role: 'answer',
    modelName: 'gemini-2.0-flash',
    systemPrompt: 'sys',
    temperature: 0.4,
    topP: null,
    maxTokens: null,
    ragTopK: 5,
    historyWindow: 8,
    isActive: true,
    isDefault: true,
    provider: {
      id: 'p1',
      provider: 'gemini',
      baseUrl: null,
      isActive: true,
    },
  };

  beforeEach(async () => {
    aiModelFindUnique = jest.fn();
    aiModelFindFirst = jest.fn();
    aiModelFindMany = jest.fn();
    aiProviderFindUnique = jest.fn();
    cacheGet = jest.fn();
    cacheSet = jest.fn();
    cacheDel = jest.fn();
    decrypt = jest.fn().mockReturnValue('plain-key');

    const prisma = {
      client: {
        aiModel: {
          findUnique: aiModelFindUnique,
          findFirst: aiModelFindFirst,
          findMany: aiModelFindMany,
        },
        aiProvider: { findUnique: aiProviderFindUnique },
      },
    } as unknown as PrismaService;

    const cache = {
      get: cacheGet,
      set: cacheSet,
      del: cacheDel,
    } as unknown as CacheService;

    const crypto = { decrypt } as unknown as AiCryptoService;

    const module = await Test.createTestingModule({
      providers: [
        AiResolverService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: AiCryptoService, useValue: crypto },
      ],
    }).compile();
    service = module.get(AiResolverService);
  });

  it('caches non-secret meta only (no apiKey in cached blob)', async () => {
    cacheGet.mockResolvedValue(null);
    aiModelFindFirst.mockResolvedValue({ id: 'm1' });
    aiModelFindUnique.mockResolvedValue(baseModel);
    aiProviderFindUnique.mockResolvedValue({
      apiKeyCiphertext: Buffer.from('a'),
      apiKeyIv: Buffer.from('b'),
      apiKeyTag: Buffer.from('c'),
      isActive: true,
    });

    const result = await service.getAnswerModel('m1');
    expect(result.decryptedApiKey).toBe('plain-key');

    expect(cacheSet).toHaveBeenCalledTimes(1);
    const cachedMeta = cacheSet.mock.calls[0][2];
    expect(JSON.stringify(cachedMeta)).not.toMatch(/apiKey|plain-key/);
    expect(cachedMeta).not.toHaveProperty('decryptedApiKey');
  });

  it('second call hits cache, skips meta SELECT, still decrypts', async () => {
    cacheGet.mockResolvedValue({
      modelId: 'm1',
      providerId: 'p1',
      providerKind: 'gemini',
      baseUrl: null,
      modelName: 'gemini-2.0-flash',
      systemPrompt: 'sys',
      temperature: 0.4,
      topP: null,
      maxTokens: null,
      ragTopK: 5,
      historyWindow: 8,
    });
    aiModelFindFirst.mockResolvedValue({ id: 'm1' });
    aiProviderFindUnique.mockResolvedValue({
      apiKeyCiphertext: Buffer.from('a'),
      apiKeyIv: Buffer.from('b'),
      apiKeyTag: Buffer.from('c'),
      isActive: true,
    });

    await service.getAnswerModel('m1');
    expect(aiModelFindUnique).not.toHaveBeenCalled();
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('invalidateProvider purges every model cache key for the provider', async () => {
    aiModelFindMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    await service.invalidateProvider('p1');
    expect(cacheDel).toHaveBeenCalledWith('ai_resolver', 'model:m1');
    expect(cacheDel).toHaveBeenCalledWith('ai_resolver', 'model:m2');
  });

  it('throws when no default answer model exists', async () => {
    aiModelFindFirst.mockResolvedValue(null);
    await expect(service.getAnswerModel()).rejects.toThrow(/default/i);
  });
});
