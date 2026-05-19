import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/database/prisma.service';
import {
  buildPrismaQuery,
  buildPaginatedResponse,
  type PaginationQueryDto,
  type PaginatedResponse,
} from '@modules/pagination';
import type { ChatMessageDto, ChatMessageRow, MessageTurn } from '../types';

function toDto(row: ChatMessageRow): ChatMessageDto {
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : null;
  const reasoning =
    metadata && typeof metadata.reasoning === 'string'
      ? metadata.reasoning
      : null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    citations: row.citations,
    reasoning,
    metadata,
    createdAt: row.createdAt,
  };
}

const ALLOWED_SORT_FIELDS = ['createdAt'];

@Injectable()
export class ChatMessageService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    sessionId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<ChatMessageDto>> {
    const args = buildPrismaQuery(query, ALLOWED_SORT_FIELDS, {
      createdAt: 'asc',
    });
    const where = { sessionId };
    const [rows, total] = await Promise.all([
      this.prisma.client.chatMessage.findMany({ ...args, where }),
      this.prisma.client.chatMessage.count({ where }),
    ]);
    return buildPaginatedResponse(rows.map(toDto), total, query);
  }

  async append(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    citations: unknown,
    metadata?: Record<string, unknown> | null,
  ): Promise<ChatMessageRow> {
    return this.prisma.client.chatMessage.create({
      data: {
        sessionId,
        role,
        content,
        citations: citations === null ? undefined : (citations as never),
        metadata: metadata == null ? undefined : (metadata as never),
      },
    });
  }

  async lastN(sessionId: string, n: number | null): Promise<MessageTurn[]> {
    const take = n && n > 0 ? n : 8;
    const rows = await this.prisma.client.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { role: true, content: true },
    });
    return rows
      .reverse()
      .filter(
        (r): r is { role: 'user' | 'assistant'; content: string } =>
          r.role === 'user' || r.role === 'assistant',
      )
      .map((r) => ({ role: r.role, content: r.content }));
  }
}
