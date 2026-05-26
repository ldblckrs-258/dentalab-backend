import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import type {
  ChatScopeResponse,
  ChatSessionResponse,
  ChatSessionRow,
} from '../types';
import { ChatStreamRegistryService } from './chat-stream-registry.service';
import { ChatScopeValidatorService } from './chat-scope-validator.service';
import { DocumentService } from '@modules/document/document.service';
import type { AuthenticatedUser } from '@common/interfaces';

const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt'];

@Injectable()
export class ChatSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly streamRegistry: ChatStreamRegistryService,
    private readonly scopeValidator: ChatScopeValidatorService,
    private readonly documentService: DocumentService,
  ) {}

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
    user: AuthenticatedUser,
    dto: UpdateSessionDto,
  ): Promise<ChatSessionRow> {
    await this.getOwnedOrThrow(sessionId, user.id);

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

    if (dto.scope !== undefined) {
      if (await this.streamRegistry.isActive(sessionId)) {
        throw new ConflictException('chat.scope.session_streaming');
      }
      const normalized = await this.scopeValidator.validateForWrite(
        dto.scope,
        user,
      );
      data.scopeType = normalized.type;
      data.scopePatientId = normalized.patientId;
      data.scopeRagDocumentIds = normalized.ragDocumentIds;
    }

    return this.prisma.client.chatSession.update({
      where: { id: sessionId },
      data,
    });
  }

  async setTitleIfEmpty(sessionId: string, title: string): Promise<void> {
    const trimmed = title.trim().slice(0, 80);
    if (!trimmed) return;
    await this.prisma.client.chatSession.updateMany({
      where: { id: sessionId, title: null },
      data: { title: trimmed },
    });
  }

  async enrichScope(
    row: ChatSessionRow,
    user: AuthenticatedUser,
  ): Promise<ChatSessionResponse> {
    const scope = await this.buildScopeResponse(
      row.scopeType,
      row.scopePatientId,
      row.scopeRagDocumentIds,
      user,
    );
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      answerModelId: row.answerModelId,
      scope,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async enrichScopeMany(
    rows: ChatSessionRow[],
    user: AuthenticatedUser,
  ): Promise<ChatSessionResponse[]> {
    return Promise.all(rows.map((r) => this.enrichScope(r, user)));
  }

  private async buildScopeResponse(
    scopeType: string | null,
    scopePatientId: string | null,
    scopeRagDocumentIds: string[],
    user: AuthenticatedUser,
  ): Promise<ChatScopeResponse> {
    if (!scopeType) return null;
    if (scopeType === 'patient' && scopePatientId) {
      const patient = await this.prisma.client.patient.findFirst({
        where: { id: scopePatientId },
        select: { id: true, firstName: true, lastName: true, deletedAt: true },
      });
      if (!patient) {
        return {
          type: 'patient',
          patientId: scopePatientId,
          patientName: '[deleted]',
          firstName: null,
          lastName: null,
          isDeleted: true,
        };
      }
      return {
        type: 'patient',
        patientId: patient.id,
        patientName: `${patient.firstName} ${patient.lastName}`.trim(),
        firstName: patient.firstName,
        lastName: patient.lastName,
        isDeleted: patient.deletedAt !== null ? true : undefined,
      };
    }
    if (scopeType === 'documents' && scopeRagDocumentIds.length > 0) {
      const ragRows = await this.prisma.client.ragDocument.findMany({
        where: { id: { in: scopeRagDocumentIds } },
        select: { id: true, sourceId: true, sourceType: true },
      });
      const docIds = ragRows
        .filter((r) => r.sourceType === 'internal_document')
        .map((r) => r.sourceId);
      const docs =
        docIds.length > 0
          ? await this.prisma.client.internalDocument.findMany({
              where: { id: { in: docIds } },
              select: { id: true, title: true, deletedAt: true },
            })
          : [];
      const docMap = new Map(docs.map((d) => [d.id, d]));
      const { allowed } =
        docIds.length > 0
          ? await this.documentService.checkAccessForMany(docIds, user)
          : { allowed: [] };
      const allowedSet = new Set(allowed);
      return {
        type: 'documents',
        documents: scopeRagDocumentIds.map((ragId) => {
          const rag = ragRows.find((r) => r.id === ragId);
          if (!rag) {
            return {
              ragDocumentId: ragId,
              documentId: '',
              title: '[deleted]',
              isDeleted: true,
            };
          }
          const doc = docMap.get(rag.sourceId);
          const hasAccess = allowedSet.has(rag.sourceId);
          if (!doc || doc.deletedAt !== null || !hasAccess) {
            return {
              ragDocumentId: ragId,
              documentId: rag.sourceId,
              title: '[deleted]',
              isDeleted: true,
            };
          }
          return {
            ragDocumentId: ragId,
            documentId: rag.sourceId,
            title: doc.title,
          };
        }),
      };
    }
    return null;
  }

  async remove(sessionId: string, userId: string): Promise<{ id: string }> {
    await this.getOwnedOrThrow(sessionId, userId);
    await this.prisma.client.chatSession.delete({ where: { id: sessionId } });
    return { id: sessionId };
  }
}
