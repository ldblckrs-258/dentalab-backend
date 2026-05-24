import { Test } from '@nestjs/testing';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import { RagService } from './rag.service';
import { PrismaService } from '@modules/database';
import { QueueProducerService } from '@modules/queue';
import { CacheService } from '@modules/redis';
import { DocumentService } from '@modules/document';
import { mockI18nContext } from '@common/test/i18n-mock';
import type { AuthenticatedUser } from '@common/interfaces';

const managerUser: AuthenticatedUser & { permissions?: string[] } = {
  id: 'user-1',
  email: 'manager@test.com',
  fullName: 'Manager',
  isActive: true,
  roleCodes: ['MANAGER'],
};

const makeRagRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rag-1',
  sourceType: 'internal_document',
  sourceId: 'doc-1',
  patientId: null,
  filename: null,
  contentType: null,
  totalParentChunks: 5,
  totalChildChunks: 10,
  status: 'completed',
  errorMessage: null,
  contentHash: 'abc123',
  ingestionTimeMs: 1500,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

describe('RagService', () => {
  let service: RagService;
  let prisma: {
    baseClient: {
      ragDocument: { findFirst: jest.Mock };
      clinicalNote: { findFirst: jest.Mock };
    };
  };
  let queueProducer: {
    publishDocumentUpdated: jest.Mock;
    publish: jest.Mock;
  };
  let cache: { setWithNX: jest.Mock; del: jest.Mock };
  let documentService: { findById: jest.Mock };

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        ragDocument: {
          findFirst: jest.fn(),
        },
        clinicalNote: {
          findFirst: jest.fn(),
        },
      },
    };

    queueProducer = {
      publishDocumentUpdated: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockReturnValue(true),
    };
    cache = { setWithNX: jest.fn(), del: jest.fn() };
    documentService = { findById: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueueProducerService, useValue: queueProducer },
        { provide: CacheService, useValue: cache },
        { provide: DocumentService, useValue: documentService },
      ],
    }).compile();

    service = module.get(RagService);
  });

  describe('getRagStatus', () => {
    it('returns mapped DTO when rag document exists', async () => {
      const row = makeRagRow();
      documentService.findById.mockResolvedValue({ id: 'doc-1' });
      prisma.baseClient.ragDocument.findFirst.mockResolvedValue(row);

      const result = await service.getRagStatus('doc-1', managerUser);

      expect(result.id).toBe('rag-1');
      expect(result.status).toBe('completed');
      expect(result.totalParentChunks).toBe(5);
      expect(result.ingestionTimeMs).toBe(1500);
    });

    it('throws NotFoundException when no rag document row exists', async () => {
      documentService.findById.mockResolvedValue({ id: 'doc-1' });
      prisma.baseClient.ragDocument.findFirst.mockResolvedValue(null);

      await expect(service.getRagStatus('doc-1', managerUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reindex', () => {
    it('publishes document.updated event when rate limit not hit', async () => {
      documentService.findById.mockResolvedValue({ id: 'doc-1' });
      cache.setWithNX.mockResolvedValue(true);

      const result = await service.reindex('doc-1', managerUser);

      expect(result).toEqual({ accepted: true });
      expect(queueProducer.publishDocumentUpdated).toHaveBeenCalledWith(
        'doc-1',
      );
    });

    it('throws 429 when rate limit key already set', async () => {
      documentService.findById.mockResolvedValue({ id: 'doc-1' });
      cache.setWithNX.mockResolvedValue(false);

      await expect(service.reindex('doc-1', managerUser)).rejects.toMatchObject(
        {
          status: HttpStatus.TOO_MANY_REQUESTS,
        },
      );
      expect(queueProducer.publishDocumentUpdated).not.toHaveBeenCalled();
    });

    it('throws when user lacks document access (documentService.findById rejects)', async () => {
      documentService.findById.mockRejectedValue(
        new NotFoundException('Document not found'),
      );

      await expect(service.reindex('doc-1', managerUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(cache.setWithNX).not.toHaveBeenCalled();
    });

    it('throws 503 and releases lock when queue publish fails', async () => {
      documentService.findById.mockResolvedValue({ id: 'doc-1' });
      cache.setWithNX.mockResolvedValue(true);
      queueProducer.publishDocumentUpdated.mockReturnValue(false);

      await expect(service.reindex('doc-1', managerUser)).rejects.toMatchObject(
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
        },
      );
      expect(cache.del).toHaveBeenCalledWith('rag:reindex', 'doc-1');
    });
  });

  describe('reindexClinicalNote', () => {
    const signedNote = {
      id: 'note-1',
      status: 'signed',
      parentNoteId: null,
    };

    it('publishes clinical_note.updated when conditions met', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(signedNote);
      prisma.baseClient.ragDocument.findFirst.mockResolvedValue(null);
      cache.setWithNX.mockResolvedValue(true);

      const result = await service.reindexClinicalNote('note-1');

      expect(result).toEqual({ accepted: true });
      expect(queueProducer.publish).toHaveBeenCalledWith(
        'clinical_note.updated',
        expect.objectContaining({
          sourceType: 'clinical_note',
          sourceId: 'note-1',
          action: 'updated',
        }),
      );
    });

    it('throws 503 and releases lock when queue publish fails', async () => {
      prisma.baseClient.clinicalNote.findFirst.mockResolvedValue(signedNote);
      prisma.baseClient.ragDocument.findFirst.mockResolvedValue(null);
      cache.setWithNX.mockResolvedValue(true);
      queueProducer.publish.mockReturnValue(false);

      await expect(service.reindexClinicalNote('note-1')).rejects.toMatchObject(
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
        },
      );
      expect(cache.del).toHaveBeenCalledWith(
        'rag:reindex:clinical_note',
        'note-1',
      );
    });
  });
});
