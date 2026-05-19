import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@modules/database/prisma.service';
import {
  buildPrismaQuery,
  buildPaginatedResponse,
  type PaginationQueryDto,
  type PaginatedResponse,
} from '@modules/pagination';
import type { CreateSessionDto } from '../dto/create-session.dto';
import type { UpdateSessionDto } from '../dto/update-session.dto';
import type { ChatSessionRow } from '../types';

const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt'];

@Injectable()
export class ChatSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateSessionDto): Promise<ChatSessionRow> {
    let answerModelId = dto.answerModelId ?? null;

    if (answerModelId) {
      const model = await this.prisma.client.aiModel.findFirst({
        where: { id: answerModelId, role: 'answer', isActive: true },
        select: { id: true },
      });
      if (!model) {
        throw new BadRequestException(
          'answerModelId not found or not an active answer model',
        );
      }
    } else {
      const def = await this.prisma.client.aiModel.findFirst({
        where: { role: 'answer', isDefault: true, isActive: true },
        select: { id: true },
      });
      answerModelId = def?.id ?? null;
    }

    return this.prisma.client.chatSession.create({
      data: {
        userId,
        title: dto.title ?? null,
        answerModelId,
      },
    });
  }

  async list(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<ChatSessionRow>> {
    const args = buildPrismaQuery(query, ALLOWED_SORT_FIELDS, {
      updatedAt: 'desc',
    });
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.client.chatSession.findMany({ ...args, where }),
      this.prisma.client.chatSession.count({ where }),
    ]);
    return buildPaginatedResponse(rows, total, query);
  }

  async getOwnedOrThrow(
    sessionId: string,
    userId: string,
  ): Promise<ChatSessionRow> {
    const row = await this.prisma.client.chatSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!row) throw new NotFoundException('Session not found');
    return row;
  }

  async update(
    sessionId: string,
    userId: string,
    dto: UpdateSessionDto,
  ): Promise<ChatSessionRow> {
    await this.getOwnedOrThrow(sessionId, userId);

    if (dto.answerModelId !== undefined) {
      const model = await this.prisma.client.aiModel.findFirst({
        where: { id: dto.answerModelId, role: 'answer', isActive: true },
        select: { id: true },
      });
      if (!model) {
        throw new BadRequestException(
          'answerModelId not found or not an active answer model',
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.answerModelId !== undefined) data.answerModelId = dto.answerModelId;

    return this.prisma.client.chatSession.update({
      where: { id: sessionId },
      data,
    });
  }

  async remove(sessionId: string, userId: string): Promise<{ id: string }> {
    await this.getOwnedOrThrow(sessionId, userId);
    await this.prisma.client.chatSession.delete({ where: { id: sessionId } });
    return { id: sessionId };
  }
}
