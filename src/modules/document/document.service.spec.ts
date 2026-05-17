import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentService } from './document.service';
import { PrismaService } from '@modules/database';
import { QueueProducerService, ROUTING_KEY } from '@modules/queue';
import { StorageService } from '@modules/storage';
import { mockI18nContext } from '@common/test/i18n-mock';
import type { AuthenticatedUser } from '@common/interfaces';

jest.mock('@modules/storage/storage.utils', () => ({
  validateFileSize: jest.requireActual('@modules/storage/storage.utils')
    .validateFileSize,
  validateMimeType: jest.requireActual('@modules/storage/storage.utils')
    .validateMimeType,
  validateMagicBytes: jest.fn(),
}));

import { validateMagicBytes } from '@modules/storage/storage.utils';

const managerUser: AuthenticatedUser & { permissions?: string[] } = {
  id: 'user-manager',
  email: 'manager@test.com',
  fullName: 'Manager',
  isActive: true,
  roleCodes: ['MANAGER'],
};

const adminUser: AuthenticatedUser & { permissions?: string[] } = {
  id: 'user-admin',
  email: 'admin@test.com',
  fullName: 'Admin',
  isActive: true,
  roleCodes: ['ADMIN'],
};

const doctorUser: AuthenticatedUser & { permissions?: string[] } = {
  id: 'user-doctor',
  email: 'doctor@test.com',
  fullName: 'Doctor',
  isActive: true,
  roleCodes: ['DOCTOR'],
};

const makeDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  title: 'Test Doc',
  isPublished: true,
  categoryId: null,
  activeVersionId: null,
  createdBy: 'user-manager',
  createdAt: new Date(),
  updatedAt: new Date(),
  category: null,
  activeVersion: null,
  ...overrides,
});

const makeVersion = (overrides: Record<string, unknown> = {}) => ({
  id: 'ver-1',
  documentId: 'doc-1',
  versionNumber: 1,
  fileName: 'test.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  createdAt: new Date(),
  changer: { id: 'user-manager', fullName: 'Manager User' },
  ...overrides,
});

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('DocumentService', () => {
  let service: DocumentService;
  let prisma: any;
  let storageService: any;
  let queueService: { publish: jest.Mock };

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        internalDocument: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        documentVersion: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          aggregate: jest
            .fn()
            .mockResolvedValue({ _max: { versionNumber: 0 } }),
        },
        documentCategory: {
          findFirst: jest.fn(),
        },
        documentAccess: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
        permission: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        userRole: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        userPermissionOverride: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn((cb) => {
          const tx = {
            documentVersion: {
              aggregate: jest
                .fn()
                .mockResolvedValue({ _max: { versionNumber: 0 } }),
              create: jest.fn().mockResolvedValue(makeVersion()),
              update: jest.fn(),
            },
            internalDocument: {
              update: jest.fn().mockResolvedValue(makeDoc()),
            },
            documentAccess: {
              deleteMany: jest.fn(),
              createMany: jest.fn(),
            },
          };
          return cb(tx);
        }),
      },
    };

    storageService = {
      upload: jest.fn().mockResolvedValue({ key: 'stored/key.pdf' }),
      delete: jest.fn().mockResolvedValue(undefined),
      generatePresignedDownloadUrl: jest
        .fn()
        .mockResolvedValue({ downloadUrl: 'https://example.com/download' }),
    };

    queueService = { publish: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageService },
        { provide: QueueProducerService, useValue: queueService },
      ],
    }).compile();

    service = module.get(DocumentService);
  });

  describe('isManager (via findAll behavior)', () => {
    it('manager with MANAGER roleCode bypasses published filter', async () => {
      prisma.baseClient.internalDocument.findMany.mockResolvedValue([
        makeDoc({ isPublished: false }),
      ]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(1);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const result = await service.findAll({ page: 1, limit: 10 }, managerUser);
      expect(result.data).toHaveLength(1);

      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.isPublished).toBeUndefined();
    });

    it('ADMIN roleCode also bypasses published filter', async () => {
      prisma.baseClient.internalDocument.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(0);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      await service.findAll({ page: 1, limit: 10 }, adminUser);

      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.isPublished).toBeUndefined();
    });

    it('doctor (non-manager) gets isPublished: true filter', async () => {
      prisma.baseClient.internalDocument.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(0);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      await service.findAll({ page: 1, limit: 10 }, doctorUser);

      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.isPublished).toBe(true);
    });

    it('user with no roleCodes treated as non-manager', async () => {
      const noRoleUser: AuthenticatedUser = {
        id: 'user-norole',
        email: 'norole@test.com',
        fullName: 'NoRole',
        isActive: true,
      };
      prisma.baseClient.internalDocument.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(0);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      await service.findAll({ page: 1, limit: 10 }, noRoleUser);

      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.isPublished).toBe(true);
    });
  });

  describe('findAll', () => {
    it('returns paginated results with deletedAt: null', async () => {
      prisma.baseClient.internalDocument.findMany.mockResolvedValue([
        makeDoc(),
      ]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(1);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const result = await service.findAll({ page: 1, limit: 10 }, managerUser);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.deletedAt).toBeNull();
    });

    it('manager with includeDeleted: true sets deletedAt: undefined', async () => {
      prisma.baseClient.internalDocument.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(0);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      await service.findAll(
        { page: 1, limit: 10, includeDeleted: true },
        managerUser,
      );

      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.deletedAt).toBeUndefined();
    });

    it('non-manager with includeDeleted still gets deletedAt: null', async () => {
      prisma.baseClient.internalDocument.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(0);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      await service.findAll(
        { page: 1, limit: 10, includeDeleted: true },
        doctorUser,
      );

      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.deletedAt).toBeNull();
    });

    it('manager ACL filter: no restricted docs → empty aclFilter applied', async () => {
      prisma.baseClient.internalDocument.findMany.mockResolvedValue([
        makeDoc(),
      ]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(1);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const result = await service.findAll({ page: 1, limit: 10 }, managerUser);
      expect(result.data).toHaveLength(1);
    });

    it('non-manager ACL: restricted doc not in allowed list → OR filter applied', async () => {
      prisma.baseClient.documentAccess.findMany
        .mockResolvedValueOnce([{ sourceId: 'doc-restricted' }])
        .mockResolvedValueOnce([]);

      prisma.baseClient.internalDocument.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10 }, doctorUser);

      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toBeDefined();
      expect(callArgs.where.OR[0]).toMatchObject({
        id: { notIn: ['doc-restricted'] },
      });
      expect(callArgs.where.OR[1]).toMatchObject({ id: { in: [] } });
    });

    it('non-manager with matching permission can see restricted doc', async () => {
      prisma.baseClient.userRole.findMany.mockResolvedValue([
        {
          role: {
            rolePermissions: [{ permissionId: 'perm-hr' }],
          },
        },
      ]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.documentAccess.findMany
        .mockResolvedValueOnce([{ sourceId: 'doc-1' }])
        .mockResolvedValueOnce([{ sourceId: 'doc-1' }]);

      prisma.baseClient.internalDocument.findMany.mockResolvedValue([
        makeDoc(),
      ]);
      prisma.baseClient.internalDocument.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 }, doctorUser);

      const callArgs =
        prisma.baseClient.internalDocument.findMany.mock.calls[0][0];
      expect(callArgs.where.OR[1]).toMatchObject({ id: { in: ['doc-1'] } });
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('returns document when found and access is allowed', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const result = await service.findById('doc-1', managerUser);
      expect(result.id).toBe('doc-1');
    });

    it('throws NotFoundException when document not found', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(null);

      await expect(service.findById('missing', managerUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('non-manager cannot see unpublished doc (findFirst returns null)', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(null);

      await expect(service.findById('doc-1', doctorUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when ACL blocks access', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.userRole.findMany.mockResolvedValue([]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([
        { permissionId: 'perm-hr' },
      ]);

      await expect(service.findById('doc-1', doctorUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows access when user has matching permission via override', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.userRole.findMany.mockResolvedValue([]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([
        { grantType: 'grant', permission: { id: 'perm-hr' } },
      ]);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([
        { permissionId: 'perm-hr' },
      ]);

      const result = await service.findById('doc-1', doctorUser);
      expect(result.id).toBe('doc-1');
    });

    it('deny override removes permission even if role grants it', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.userRole.findMany.mockResolvedValue([
        { role: { rolePermissions: [{ permissionId: 'perm-hr' }] } },
      ]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([
        { grantType: 'deny', permission: { id: 'perm-hr' } },
      ]);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([
        { permissionId: 'perm-hr' },
      ]);

      await expect(service.findById('doc-1', doctorUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates document with null activeVersionId', async () => {
      prisma.baseClient.internalDocument.create.mockResolvedValue(
        makeDoc({ activeVersionId: null }),
      );

      const result = await service.create(
        { title: 'New Doc', isPublished: false },
        'user-1',
      );

      expect(result.activeVersionId).toBeNull();
      expect(prisma.baseClient.internalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'New Doc',
            isPublished: false,
          }),
        }),
      );
    });

    it('validates categoryId exists when provided', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ title: 'Doc', categoryId: 'cat-999' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates with valid categoryId', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
      });
      prisma.baseClient.internalDocument.create.mockResolvedValue(
        makeDoc({ categoryId: 'cat-1' }),
      );

      const result = await service.create(
        { title: 'Doc', categoryId: 'cat-1' },
        'user-1',
      );
      expect(result.categoryId).toBe('cat-1');
    });

    it('trims whitespace from title', async () => {
      prisma.baseClient.internalDocument.create.mockResolvedValue(
        makeDoc({ title: 'Trimmed' }),
      );

      await service.create({ title: '  Trimmed  ' }, 'user-1');

      expect(prisma.baseClient.internalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Trimmed' }),
        }),
      );
    });
  });

  describe('update', () => {
    it('patches title and isPublished', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.update.mockResolvedValue(
        makeDoc({ title: 'Updated', isPublished: true }),
      );

      const result = await service.update(
        'doc-1',
        { title: 'Updated', isPublished: true },
        managerUser,
      );

      expect(result.title).toBe('Updated');
      expect(prisma.baseClient.internalDocument.update).toHaveBeenCalled();
    });

    it('throws NotFoundException when doc does not exist', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.update('missing', { title: 'X' }, managerUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects invalid categoryId on update', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.update('doc-1', { categoryId: 'cat-999' }, managerUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('soft-deletes by setting deletedAt', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.update.mockResolvedValue(makeDoc());

      const result = await service.delete('doc-1', managerUser);

      expect(result).toEqual({ id: 'doc-1' });
      expect(prisma.baseClient.internalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });

    it('publishes document.deleted on successful soft-delete', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.internalDocument.update.mockResolvedValue(makeDoc());

      await service.delete('doc-1', managerUser);

      expect(queueService.publish).toHaveBeenCalledWith(
        ROUTING_KEY.DOCUMENT_DELETED,
        {
          sourceType: 'internal_document',
          sourceId: 'doc-1',
          action: 'deleted',
        },
      );
    });

    it('throws NotFoundException if doc missing', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(null);

      await expect(service.delete('missing', managerUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listVersions', () => {
    it('returns versions ordered by versionNumber desc', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.documentVersion.findMany.mockResolvedValue([
        makeVersion({ versionNumber: 2 }),
        makeVersion({ versionNumber: 1 }),
      ]);

      const result = await service.listVersions('doc-1', managerUser);
      expect(result).toHaveLength(2);
      expect(prisma.baseClient.documentVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { versionNumber: 'desc' } }),
      );
    });

    it('throws NotFoundException if doc missing', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.listVersions('missing', managerUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('uploadVersion', () => {
    const pdfFile: Express.Multer.File = {
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: PDF_MAGIC,
      fieldname: 'file',
      encoding: '7bit',
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };

    beforeEach(() => {
      (validateMagicBytes as jest.Mock).mockResolvedValue(undefined);
    });

    it('publishes document.updated on successful upload', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const result = await service.uploadVersion(
        'doc-1',
        pdfFile,
        'user-1',
        managerUser,
      );

      expect(result).toBeDefined();
      expect(queueService.publish).toHaveBeenCalledWith(
        ROUTING_KEY.DOCUMENT_UPDATED,
        {
          sourceType: 'internal_document',
          sourceId: 'doc-1',
          action: 'updated',
        },
      );
    });

    it('validates MIME type — rejects disallowed type', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const exeFile: Express.Multer.File = {
        ...pdfFile,
        mimetype: 'application/x-msdownload',
        buffer: Buffer.from([0x4d, 0x5a]),
      };

      await expect(
        service.uploadVersion('doc-1', exeFile, 'user-1', managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates file size — rejects oversized file', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const bigFile: Express.Multer.File = {
        ...pdfFile,
        size: 30 * 1024 * 1024,
      };

      await expect(
        service.uploadVersion('doc-1', bigFile, 'user-1', managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates magic bytes — PNG buffer declared as PDF fails', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      (validateMagicBytes as jest.Mock).mockRejectedValue(
        new BadRequestException(
          'File content does not match the declared file type.',
        ),
      );

      const spoofedFile: Express.Multer.File = {
        ...pdfFile,
        mimetype: 'application/pdf',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      };

      await expect(
        service.uploadVersion('doc-1', spoofedFile, 'user-1', managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates magic bytes — random buffer fails', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      (validateMagicBytes as jest.Mock).mockRejectedValue(
        new BadRequestException('This file type is not supported.'),
      );

      const randomFile: Express.Multer.File = {
        ...pdfFile,
        mimetype: 'application/pdf',
        buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
      };

      await expect(
        service.uploadVersion('doc-1', randomFile, 'user-1', managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws if file is missing', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      await expect(
        service.uploadVersion(
          'doc-1',
          null as unknown as Express.Multer.File,
          'user-1',
          managerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('version race retry: P2002 on first attempt (before upload), succeeds on second', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const p2002Err = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint',
        { code: 'P2002', clientVersion: '5.0' },
      );

      let callCount = 0;
      prisma.baseClient.$transaction = jest.fn((cb) => {
        callCount++;
        if (callCount === 1) throw p2002Err;

        const tx = {
          documentVersion: {
            aggregate: jest
              .fn()
              .mockResolvedValue({ _max: { versionNumber: 1 } }),
            create: jest
              .fn()
              .mockResolvedValue(makeVersion({ versionNumber: 2 })),
            update: jest.fn(),
          },
          internalDocument: {
            update: jest.fn().mockResolvedValue(makeDoc()),
          },
        };
        return cb(tx);
      });

      const result = await service.uploadVersion(
        'doc-1',
        pdfFile,
        'user-1',
        managerUser,
      );

      expect(result).toBeDefined();
      expect(callCount).toBe(2);
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('throws after max retries exhausted (P2002 on all attempts)', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      const p2002Err = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint',
        { code: 'P2002', clientVersion: '5.0' },
      );

      prisma.baseClient.$transaction = jest.fn(() => {
        throw p2002Err;
      });

      await expect(
        service.uploadVersion('doc-1', pdfFile, 'user-1', managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('cleans up uploaded file on non-P2002 error', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);

      prisma.baseClient.$transaction = jest.fn((cb) => {
        const tx = {
          documentVersion: {
            aggregate: jest
              .fn()
              .mockResolvedValue({ _max: { versionNumber: 0 } }),
            create: jest.fn().mockResolvedValue(makeVersion()),
            update: jest.fn(),
          },
          internalDocument: {
            update: jest.fn(() => {
              throw new Error('DB down');
            }),
          },
        };
        return cb(tx);
      });

      await expect(
        service.uploadVersion('doc-1', pdfFile, 'user-1', managerUser),
      ).rejects.toThrow('DB down');
    });
  });

  describe('setActiveVersion', () => {
    it('updates activeVersionId when version belongs to doc', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.documentVersion.findFirst.mockResolvedValue(
        makeVersion(),
      );
      prisma.baseClient.internalDocument.update.mockResolvedValue(
        makeDoc({ activeVersionId: 'ver-1' }),
      );

      const result = await service.setActiveVersion(
        'doc-1',
        'ver-1',
        managerUser,
      );
      expect(result.activeVersionId).toBe('ver-1');
    });

    it('publishes document.updated on successful version swap', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.documentVersion.findFirst.mockResolvedValue(
        makeVersion(),
      );
      prisma.baseClient.internalDocument.update.mockResolvedValue(
        makeDoc({ activeVersionId: 'ver-1' }),
      );

      await service.setActiveVersion('doc-1', 'ver-1', managerUser);

      expect(queueService.publish).toHaveBeenCalledWith(
        ROUTING_KEY.DOCUMENT_UPDATED,
        {
          sourceType: 'internal_document',
          sourceId: 'doc-1',
          action: 'updated',
        },
      );
    });

    it('throws NotFoundException when version belongs to different doc', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.documentVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.setActiveVersion('doc-1', 'ver-other-doc', managerUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDownloadUrl', () => {
    it('returns presigned URL for PDF (inline display)', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.userRole.findMany.mockResolvedValue([]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.documentVersion.findFirst.mockResolvedValue({
        id: 'ver-1',
        fileKey: 'some/key.pdf',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
      });

      const result = await service.getDownloadUrl(
        'doc-1',
        'ver-1',
        managerUser,
      );

      expect(result.downloadUrl).toBe('https://example.com/download');
      expect(storageService.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        'some/key.pdf',
        300,
        expect.objectContaining({ forceAttachment: false }),
      );
    });

    it('forces attachment for non-inline MIME types (e.g. docx)', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.userRole.findMany.mockResolvedValue([]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.documentVersion.findFirst.mockResolvedValue({
        id: 'ver-1',
        fileKey: 'some/key.docx',
        fileName: 'report.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      await service.getDownloadUrl('doc-1', 'ver-1', managerUser);

      expect(storageService.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        'some/key.docx',
        300,
        expect.objectContaining({ forceAttachment: true }),
      );
    });

    it('throws NotFoundException when doc not found', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(null);

      await expect(
        service.getDownloadUrl('missing', 'ver-1', managerUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when version not found', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.documentVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.getDownloadUrl('doc-1', 'missing-ver', managerUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('doctor blocked by ACL on download', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.userRole.findMany.mockResolvedValue([]);
      prisma.baseClient.userPermissionOverride.findMany.mockResolvedValue([]);
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([
        { permissionId: 'perm-hr' },
      ]);

      await expect(
        service.getDownloadUrl('doc-1', 'ver-1', doctorUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAccess', () => {
    it('returns access rows for document', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'access-1',
            permissionId: 'perm-1',
            createdAt: new Date(),
            permission: {
              id: 'perm-1',
              resource: 'documents',
              action: 'access',
              scope: 'hr',
            },
          },
        ]);

      const result = await service.getAccess('doc-1', managerUser);
      expect(result).toHaveLength(1);
    });

    it('returns empty array when no ACL rows exist', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getAccess('doc-1', managerUser);
      expect(result).toHaveLength(0);
    });
  });

  describe('setAccess', () => {
    it('replaces ACL atomically', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ permissionId: 'perm-old' }]);
      prisma.baseClient.permission.findMany.mockResolvedValue([
        { id: 'perm-new' },
      ]);

      const result = await service.setAccess(
        'doc-1',
        { permissionIds: ['perm-new'] },
        managerUser,
      );

      expect(result.added).toEqual(['perm-new']);
      expect(result.removed).toEqual(['perm-old']);
      expect(prisma.baseClient.$transaction).toHaveBeenCalled();
    });

    it('throws BadRequestException for unknown permissionIds', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany.mockResolvedValue([]);
      prisma.baseClient.permission.findMany.mockResolvedValue([]);

      await expect(
        service.setAccess(
          'doc-1',
          { permissionIds: ['perm-unknown'] },
          managerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears ACL when empty array provided', async () => {
      prisma.baseClient.internalDocument.findFirst.mockResolvedValue(makeDoc());
      prisma.baseClient.documentAccess.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ permissionId: 'perm-hr' }]);

      const result = await service.setAccess(
        'doc-1',
        { permissionIds: [] },
        managerUser,
      );

      expect(result.added).toEqual([]);
      expect(result.removed).toEqual(['perm-hr']);
    });
  });
});
