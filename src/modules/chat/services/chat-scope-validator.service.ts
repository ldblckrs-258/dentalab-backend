import type { AuthenticatedUser } from '@common/interfaces';
import { PrismaService } from '@modules/database/prisma.service';
import { DocumentService } from '@modules/document/document.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ScopeDto, ScopeType } from '../dto/chat-scope.dto';

export interface PersistedScope {
  scopeType: string | null;
  scopePatientId: string | null;
  scopeRagDocumentIds: string[];
}

export interface NormalizedScope {
  type: ScopeType | null;
  patientId: string | null;
  ragDocumentIds: string[];
}

export interface EffectiveScope {
  type: ScopeType;
  patientId?: string;
  ragDocumentIds?: string[];
  removed?: {
    documents?: Array<{
      ragDocumentId: string;
      reason: 'deleted' | 'permission_revoked' | 'not_indexed';
    }>;
    patient?: { reason: 'deleted' | 'permission_revoked' };
  };
}

@Injectable()
export class ChatScopeValidatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentService: DocumentService,
  ) {}

  async validateForWrite(
    scope: ScopeDto | null,
    user: AuthenticatedUser & { permissions?: string[] },
  ): Promise<NormalizedScope> {
    if (scope === null) {
      return { type: null, patientId: null, ragDocumentIds: [] };
    }

    if (scope.type === 'patient') {
      const patientId = scope.patientId!;
      const patient = await this.prisma.client.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { id: true },
      });
      if (!patient) {
        throw new NotFoundException('chat.scope.patient_not_found');
      }
      const allowed =
        user.permissions?.includes('patients:read') ?? this.isAdmin(user);
      if (!allowed) {
        throw new ForbiddenException('chat.scope.permission_denied');
      }
      return { type: 'patient', patientId, ragDocumentIds: [] };
    }

    const ids = scope.ragDocumentIds ?? [];
    if (ids.length === 0 || ids.length > 5) {
      throw new BadRequestException('chat.scope.documents_required');
    }
    const ragRows = await this.prisma.client.ragDocument.findMany({
      where: {
        id: { in: ids },
        sourceType: 'internal_document',
        status: 'completed',
      },
      select: { id: true, sourceId: true },
    });
    if (ragRows.length !== ids.length) {
      throw new NotFoundException('chat.scope.document_not_indexed');
    }
    const internalDocIds = ragRows.map((r) => r.sourceId);
    const { denied } = await this.documentService.checkAccessForMany(
      internalDocIds,
      user,
    );
    if (denied.length > 0) {
      throw new ForbiddenException('chat.scope.permission_denied');
    }
    return {
      type: 'documents',
      patientId: null,
      ragDocumentIds: ragRows.map((r) => r.id),
    };
  }

  async materializeForTurn(
    persisted: PersistedScope,
    user: AuthenticatedUser & { permissions?: string[] },
  ): Promise<EffectiveScope | null> {
    if (!persisted.scopeType) return null;

    if (persisted.scopeType === 'patient' && persisted.scopePatientId) {
      const patient = await this.prisma.client.patient.findFirst({
        where: { id: persisted.scopePatientId, deletedAt: null },
        select: { id: true },
      });
      if (!patient) {
        return {
          type: 'patient',
          removed: { patient: { reason: 'deleted' } },
        };
      }
      const allowed =
        user.permissions?.includes('patients:read') ?? this.isAdmin(user);
      if (!allowed) {
        return {
          type: 'patient',
          removed: { patient: { reason: 'permission_revoked' } },
        };
      }
      return { type: 'patient', patientId: persisted.scopePatientId };
    }

    if (persisted.scopeType === 'documents') {
      const ids = persisted.scopeRagDocumentIds ?? [];
      if (ids.length === 0) return null;
      const ragRows = await this.prisma.client.ragDocument.findMany({
        where: { id: { in: ids }, status: 'completed' },
        select: { id: true, sourceId: true },
      });
      const stillIndexed = new Map(ragRows.map((r) => [r.id, r.sourceId]));
      const notIndexed = ids.filter((id) => !stillIndexed.has(id));

      const indexedDocIds = Array.from(stillIndexed.values());
      const { allowed, denied } = await this.documentService.checkAccessForMany(
        indexedDocIds,
        user,
      );
      const allowedSet = new Set(allowed);
      const allowedRagIds: string[] = [];
      const permissionRevokedRagIds: string[] = [];
      for (const [ragId, docId] of stillIndexed) {
        if (allowedSet.has(docId)) {
          allowedRagIds.push(ragId);
        } else if (denied.includes(docId)) {
          permissionRevokedRagIds.push(ragId);
        }
      }

      const removedDocs = [
        ...notIndexed.map((ragDocumentId) => ({
          ragDocumentId,
          reason: 'not_indexed' as const,
        })),
        ...permissionRevokedRagIds.map((ragDocumentId) => ({
          ragDocumentId,
          reason: 'permission_revoked' as const,
        })),
      ];

      if (allowedRagIds.length === 0) {
        return removedDocs.length > 0
          ? {
              type: 'documents',
              ragDocumentIds: [],
              removed: { documents: removedDocs },
            }
          : null;
      }

      return {
        type: 'documents',
        ragDocumentIds: allowedRagIds,
        ...(removedDocs.length > 0
          ? { removed: { documents: removedDocs } }
          : {}),
      };
    }

    return null;
  }

  private isAdmin(user: AuthenticatedUser): boolean {
    const roleCodes = user.roleCodes ?? [];
    return roleCodes.includes('ADMIN');
  }
}
