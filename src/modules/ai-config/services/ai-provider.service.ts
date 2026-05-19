import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database/prisma.service';
import { AiCryptoService } from './ai-crypto.service';
import { AiResolverService } from './ai-resolver.service';
import type { CreateProviderDto } from '../dto/create-provider.dto';
import type { UpdateProviderDto } from '../dto/update-provider.dto';
import {
  toProviderResponse,
  type ProviderResponseDto,
} from '../dto/provider-response.dto';

@Injectable()
export class AiProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AiCryptoService,
    private readonly resolver: AiResolverService,
  ) {}

  async create(
    dto: CreateProviderDto,
    actorUserId: string,
  ): Promise<ProviderResponseDto> {
    const enc = this.crypto.encrypt(dto.apiKey);
    const row = await this.prisma.client.aiProvider.create({
      data: {
        name: dto.name,
        provider: dto.provider,
        apiKeyCiphertext: new Uint8Array(enc.ciphertext),
        apiKeyIv: new Uint8Array(enc.iv),
        apiKeyTag: new Uint8Array(enc.tag),
        apiKeyLast4: dto.apiKey.slice(-4),
        baseUrl: dto.baseUrl ?? null,
        isActive: dto.isActive ?? true,
        createdBy: actorUserId,
      },
    });
    return toProviderResponse(row);
  }

  async findAll(): Promise<ProviderResponseDto[]> {
    const rows = await this.prisma.client.aiProvider.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toProviderResponse);
  }

  async findOne(id: string): Promise<ProviderResponseDto> {
    const row = await this.prisma.client.aiProvider.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Provider not found');
    return toProviderResponse(row);
  }

  async update(
    id: string,
    dto: UpdateProviderDto,
  ): Promise<ProviderResponseDto> {
    const existing = await this.prisma.client.aiProvider.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Provider not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.baseUrl !== undefined) data.baseUrl = dto.baseUrl;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.apiKey !== undefined) {
      if (dto.apiKey.length < 8) {
        throw new BadRequestException('apiKey too short');
      }
      const enc = this.crypto.encrypt(dto.apiKey);
      data.apiKeyCiphertext = enc.ciphertext;
      data.apiKeyIv = enc.iv;
      data.apiKeyTag = enc.tag;
      data.apiKeyLast4 = dto.apiKey.slice(-4);
    }

    const row = await this.prisma.client.aiProvider.update({
      where: { id },
      data,
    });

    await this.resolver.invalidateProvider(id);
    return toProviderResponse(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.client.aiProvider.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Provider not found');
    await this.prisma.client.aiProvider.delete({ where: { id } });
    await this.resolver.invalidateProvider(id);
    return { id };
  }
}
