import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database/prisma.service';
import type { AiModelRow as AiModel } from '../types';
import { AiResolverService } from './ai-resolver.service';
import type { CreateModelDto } from '../dto/create-model.dto';
import type { UpdateModelDto } from '../dto/update-model.dto';
import type { ListModelsQueryDto } from '../dto/list-models-query.dto';

export type { AiModelRow } from '../types';

@Injectable()
export class AiModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: AiResolverService,
  ) {}

  async create(dto: CreateModelDto): Promise<AiModel> {
    const provider = await this.prisma.client.aiProvider.findUnique({
      where: { id: dto.providerId },
      select: { id: true },
    });
    if (!provider) throw new BadRequestException('providerId not found');

    if (dto.role === 'rewrite' && dto.isDefault) {
      throw new BadRequestException('Rewrite models cannot be marked default');
    }
    if (dto.role === 'rewrite' && dto.ragTopK !== undefined) {
      throw new BadRequestException('ragTopK only applies to answer models');
    }

    return this.prisma.transaction(async (tx) => {
      const isActive = dto.isActive ?? true;
      if (dto.role === 'rewrite' && isActive) {
        await tx.aiModel.updateMany({
          where: { role: 'rewrite', isActive: true },
          data: { isActive: false },
        });
      }
      if (dto.role === 'answer' && dto.isDefault) {
        await tx.aiModel.updateMany({
          where: { role: 'answer', isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.aiModel.create({
        data: {
          providerId: dto.providerId,
          role: dto.role,
          modelName: dto.modelName,
          displayName: dto.displayName,
          userInstruction: dto.userInstruction ?? null,
          temperature: dto.temperature ?? 0.4,
          topP: dto.topP ?? null,
          maxTokens: dto.maxTokens ?? null,
          ragTopK: dto.role === 'answer' ? (dto.ragTopK ?? 5) : null,
          historyWindow:
            dto.role === 'answer' ? (dto.historyWindow ?? 8) : null,
          isActive,
          isDefault: dto.role === 'answer' ? (dto.isDefault ?? false) : false,
        },
      });
    });
  }

  async findAll(query: ListModelsQueryDto): Promise<AiModel[]> {
    const where: Record<string, unknown> = {};
    if (query.role) where.role = query.role;
    if (query.active !== undefined) {
      where.isActive = query.active === 'true';
    }
    return this.prisma.client.aiModel.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string): Promise<AiModel> {
    const row = await this.prisma.client.aiModel.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Model not found');
    return row;
  }

  async update(id: string, dto: UpdateModelDto): Promise<AiModel> {
    const existing = await this.prisma.client.aiModel.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Model not found');

    const finalRole = dto.role ?? existing.role;
    const finalIsActive = dto.isActive ?? existing.isActive;
    const finalIsDefault = dto.isDefault ?? existing.isDefault;

    if (finalRole === 'rewrite' && finalIsDefault) {
      throw new BadRequestException('Rewrite models cannot be default');
    }

    const updated = await this.prisma.transaction(async (tx) => {
      if (finalRole === 'rewrite' && finalIsActive) {
        await tx.aiModel.updateMany({
          where: { role: 'rewrite', isActive: true, NOT: { id } },
          data: { isActive: false },
        });
      }
      if (finalRole === 'answer' && finalIsDefault) {
        await tx.aiModel.updateMany({
          where: { role: 'answer', isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      const data: Record<string, unknown> = {};
      if (dto.role !== undefined) data.role = dto.role;
      if (dto.modelName !== undefined) data.modelName = dto.modelName;
      if (dto.displayName !== undefined) data.displayName = dto.displayName;
      if (dto.userInstruction !== undefined)
        data.userInstruction = dto.userInstruction;
      if (dto.temperature !== undefined) data.temperature = dto.temperature;
      if (dto.topP !== undefined) data.topP = dto.topP;
      if (dto.maxTokens !== undefined) data.maxTokens = dto.maxTokens;
      if (dto.ragTopK !== undefined) data.ragTopK = dto.ragTopK;
      if (dto.historyWindow !== undefined)
        data.historyWindow = dto.historyWindow;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

      return tx.aiModel.update({ where: { id }, data });
    });

    await this.resolver.invalidateModel(id);
    return updated;
  }

  async remove(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.client.aiModel.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Model not found');
    await this.prisma.client.aiModel.delete({ where: { id } });
    await this.resolver.invalidateModel(id);
    return { id };
  }
}
