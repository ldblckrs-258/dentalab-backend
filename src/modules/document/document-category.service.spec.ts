import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentCategoryService } from './document-category.service';
import { PrismaService } from '@modules/database';
import { mockI18nContext } from '@common/test/i18n-mock';

const makeCat = (overrides: Record<string, unknown> = {}) => ({
  id: 'cat-1',
  name: 'HR Documents',
  description: 'Human Resources docs',
  createdBy: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { documents: 0 },
  ...overrides,
});

const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
  code: 'P2002',
  clientVersion: '5.0',
});

describe('DocumentCategoryService', () => {
  let service: DocumentCategoryService;
  let prisma: any;

  beforeEach(async () => {
    mockI18nContext();

    prisma = {
      baseClient: {
        documentCategory: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        internalDocument: {
          updateMany: jest.fn(),
        },
        $transaction: jest.fn((cb) => {
          const tx = {
            documentCategory: {
              update: jest.fn(),
            },
            internalDocument: {
              updateMany: jest.fn(),
            },
          };
          return cb(tx);
        }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        DocumentCategoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DocumentCategoryService);
  });

  describe('findAll', () => {
    it('returns paginated results with deletedAt: null', async () => {
      prisma.baseClient.documentCategory.findMany.mockResolvedValue([
        makeCat(),
      ]);
      prisma.baseClient.documentCategory.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      const callArgs =
        prisma.baseClient.documentCategory.findMany.mock.calls[0][0];
      expect(callArgs.where.deletedAt).toBeNull();
    });

    it('filters by search term on name field', async () => {
      prisma.baseClient.documentCategory.findMany.mockResolvedValue([]);
      prisma.baseClient.documentCategory.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10, search: 'HR' });

      const callArgs =
        prisma.baseClient.documentCategory.findMany.mock.calls[0][0];
      expect(callArgs.where.name).toMatchObject({
        contains: 'HR',
        mode: 'insensitive',
      });
    });

    it('returns empty list when no categories exist', async () => {
      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('findById', () => {
    it('returns category when found', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(makeCat());

      const result = await service.findById('cat-1');
      expect(result.id).toBe('cat-1');
      expect(result.name).toBe('HR Documents');
    });

    it('throws NotFoundException when category not found', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('queries with deletedAt: null', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(makeCat());

      await service.findById('cat-1');

      expect(prisma.baseClient.documentCategory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'cat-1', deletedAt: null }),
        }),
      );
    });
  });

  describe('create', () => {
    it('creates a category and trims name', async () => {
      prisma.baseClient.documentCategory.create.mockResolvedValue(makeCat());

      const result = await service.create(
        { name: '  HR Documents  ' },
        'user-1',
      );

      expect(result.id).toBe('cat-1');
      expect(prisma.baseClient.documentCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'HR Documents',
            createdBy: 'user-1',
          }),
        }),
      );
    });

    it('creates with optional description', async () => {
      prisma.baseClient.documentCategory.create.mockResolvedValue(
        makeCat({ description: 'Desc' }),
      );

      await service.create({ name: 'Cat', description: 'Desc' }, 'user-1');

      expect(prisma.baseClient.documentCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: 'Desc' }),
        }),
      );
    });

    it('sets description to null when not provided', async () => {
      prisma.baseClient.documentCategory.create.mockResolvedValue(
        makeCat({ description: null }),
      );

      await service.create({ name: 'Cat' }, 'user-1');

      expect(prisma.baseClient.documentCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: null }),
        }),
      );
    });

    it('throws ConflictException on P2002 (duplicate name)', async () => {
      prisma.baseClient.documentCategory.create.mockRejectedValue(p2002);

      await expect(
        service.create({ name: 'Existing' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows non-P2002 errors', async () => {
      const genericErr = new Error('DB connection lost');
      prisma.baseClient.documentCategory.create.mockRejectedValue(genericErr);

      await expect(service.create({ name: 'Cat' }, 'user-1')).rejects.toThrow(
        'DB connection lost',
      );
    });
  });

  describe('update', () => {
    it('updates name and description', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(makeCat());
      prisma.baseClient.documentCategory.update.mockResolvedValue(
        makeCat({ name: 'Updated', description: 'New desc' }),
      );

      const result = await service.update('cat-1', {
        name: 'Updated',
        description: 'New desc',
      });
      expect(result.name).toBe('Updated');
    });

    it('trims name on update', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(makeCat());
      prisma.baseClient.documentCategory.update.mockResolvedValue(
        makeCat({ name: 'Trimmed' }),
      );

      await service.update('cat-1', { name: '  Trimmed  ' });

      expect(prisma.baseClient.documentCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Trimmed' }),
        }),
      );
    });

    it('sets description to null when explicitly passed null', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(makeCat());
      prisma.baseClient.documentCategory.update.mockResolvedValue(
        makeCat({ description: null }),
      );

      await service.update('cat-1', { description: null });

      expect(prisma.baseClient.documentCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: null }),
        }),
      );
    });

    it('throws NotFoundException when category not found', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException on P2002 (duplicate name)', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(makeCat());
      prisma.baseClient.documentCategory.update.mockRejectedValue(p2002);

      await expect(
        service.update('cat-1', { name: 'Duplicate' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows non-P2002 errors on update', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(makeCat());
      prisma.baseClient.documentCategory.update.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(service.update('cat-1', { name: 'X' })).rejects.toThrow(
        'DB error',
      );
    });
  });

  describe('delete', () => {
    it('soft-deletes category and nullifies referencing docs in transaction', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(makeCat());

      const result = await service.delete('cat-1');

      expect(result).toEqual({ id: 'cat-1' });
      expect(prisma.baseClient.$transaction).toHaveBeenCalled();

      const txCb = prisma.baseClient.$transaction.mock.calls[0][0];
      const mockTx = {
        documentCategory: { update: jest.fn() },
        internalDocument: { updateMany: jest.fn() },
      };
      await txCb(mockTx);

      expect(mockTx.documentCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cat-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(mockTx.internalDocument.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { categoryId: 'cat-1' },
          data: { categoryId: null },
        }),
      );
    });

    it('throws NotFoundException when category not found', async () => {
      prisma.baseClient.documentCategory.findFirst.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
